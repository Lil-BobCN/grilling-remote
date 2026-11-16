"""通知模块命令行：python3 -m notifier send --event-file <路径>。

输入是一条通知事件 JSON；输出一行结果 JSON。退出码 0 全部送到，
1 至少一路在重试后仍失败，2 输入或配置错。

失败处理按 docs/通知.md 的「重复与失败」一节和 D-0202：
- 推送（webhook）失败重试，默认 3 次、间隔 30 秒；邮件只发一次。
- 出事的推送失败后写一条 fallback 日志，邮件腿就是兜底。
- 推送连续失败 3 次发「通知通道可能断了」邮件，一天最多一封。
- 已推标记按 key 记在 state.json；全部通道送到后同一 key 跳过。
- 失败事件留档，通道恢复后补发，只补失败过的通道。
- 两路都失败的证据写「通道断了」日志。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from . import config as config_module
from . import state as state_module
from .channels import push as push_channel
from .channels import smtp as smtp_channel
from .templates import EVENTS, EventError, render_event

EXIT_OK = 0
EXIT_CHANNEL_FAILED = 1
EXIT_BAD_INPUT = 2

CHANNEL_ORDER = ("push", "email")
RETRY_CHANNELS = frozenset({"push"})
ALERT_CHANNEL = "email"
ALERT_TITLE = "通知通道可能断了"
ALERT_THRESHOLD = 3
FALLBACK_EVENTS = {"出事": "email"}
SECRET_SERVICES = {
    "email": config_module.KEYCHAIN_SMTP_PASSWORD,
    "push": config_module.KEYCHAIN_WECOM_WEBHOOK,
}
DEFAULT_SENDERS = {"email": smtp_channel.send, "push": push_channel.send}


def _now():
    return datetime.now().astimezone()


def _parse_args(argv):
    parser = argparse.ArgumentParser(prog="python3 -m notifier")
    subparsers = parser.add_subparsers(dest="command", required=True)
    send = subparsers.add_parser("send", help="发送一条通知事件")
    send.add_argument("--event-file", required=True, help="通知事件 JSON 路径")
    send.add_argument("--channel", choices=CHANNEL_ORDER, help="只发一路，测试用")
    return parser.parse_args(argv)


def _load_event(path):
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise EventError(f"读不到事件文件 {path}：{exc}") from exc
    try:
        event = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise EventError(f"事件文件不是合法 JSON：{exc}") from exc
    if not isinstance(event, dict):
        raise EventError("事件文件顶层必须是对象")
    version = event.get("v")
    if isinstance(version, bool) or not isinstance(version, int) or version != 1:
        raise EventError("事件字段 v 必须是整数 1")
    for field in ("key", "event", "occurred_at"):
        value = event.get(field)
        if not isinstance(value, str) or not value.strip():
            raise EventError(f"事件字段 {field} 必须是非空字符串")
    return event


def _enabled(config, name):
    return config.email.enabled if name == "email" else config.push.enabled


def _effective_channels(event_name, requested, config):
    if requested is not None:
        if not _enabled(config, requested):
            raise config_module.ConfigError(f"通道 {requested} 未启用")
        return (requested,)
    mapped = EVENTS[event_name].channels
    channels = tuple(
        name for name in CHANNEL_ORDER
        if name in mapped and _enabled(config, name)
    )
    if not channels:
        raise config_module.ConfigError(
            f"事件「{event_name}」的通道都未启用：{', '.join(mapped)}")
    return channels


def _write_log(config, record, ok, now):
    if config.log_level == "error" and ok:
        return
    line = {"ts": now.isoformat(timespec="seconds"), **record}
    config.log_path.parent.mkdir(parents=True, exist_ok=True)
    with config.log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line, ensure_ascii=False) + "\n")


def _deliver_channel(name, *, event, title, body, config, senders, secret,
                     state, home, clock):
    """按配置重试一个通道，逐次写日志和连续失败计数。"""
    attempts = config.retry.attempts if name in RETRY_CHANNELS else 1
    channel_config = config.email if name == "email" else config.push
    total_started = time.monotonic()
    last_error = None
    for attempt in range(1, attempts + 1):
        started = time.monotonic()
        error = None
        try:
            senders[name](channel_config, title, body, secret)
        except Exception as exc:  # 这一路失败，继续按策略重试或结束
            error = f"{type(exc).__name__}: {exc}"
        elapsed = int((time.monotonic() - started) * 1000)
        now = clock()
        record = {
            "event": event["event"],
            "key": event["key"],
            "channel": name,
            "ok": error is None,
            "attempt": attempt,
            "attempts": attempts,
            "ms": elapsed,
        }
        if error is not None:
            record["error"] = error
            if attempt < attempts:
                record["retry_in"] = config.retry.interval_seconds
        _write_log(config, record, error is None, now)

        prior = state_module.failure_count(state, name)
        if error is None:
            state_module.set_failure_count(state, name, 0)
        else:
            state_module.set_failure_count(state, name, prior + 1)
        state_module.save(home, state)
        if error is None:
            return {
                "ok": True,
                "ms": elapsed,
                "attempts": attempt,
                "error": None,
            }
        last_error = error
        if attempt < attempts:
            time.sleep(config.retry.interval_seconds)

    return {
        "ok": False,
        "ms": int((time.monotonic() - total_started) * 1000),
        "attempts": attempts,
        "error": last_error,
    }


def _flush_pending(*, state, home, config, channel, senders, secret_reader, clock):
    """通道刚恢复：把失败过这条通道的事件各补发一次。"""
    if not any(channel in entry["failed"]
               for entry in state["pending"].values()):
        return
    secret = None
    secret_error = None
    try:
        secret = secret_reader(SECRET_SERVICES[channel])
    except config_module.ConfigError as exc:
        secret_error = str(exc)
    for key, entry in list(state["pending"].items()):
        if channel not in entry["failed"]:
            continue
        event = entry["event"]
        now = clock()
        error = secret_error
        elapsed = 0
        if error is None:
            try:
                title, body = render_event(
                    event["event"], event.get("data"), event.get("link"))
            except EventError as exc:
                error = str(exc)
            else:
                started = time.monotonic()
                try:
                    channel_config = config.email if channel == "email" else config.push
                    senders[channel](channel_config, title, body, secret)
                except Exception as exc:
                    error = f"{type(exc).__name__}: {exc}"
                elapsed = int((time.monotonic() - started) * 1000)
        record = {
            "event": event.get("event"),
            "key": key,
            "channel": channel,
            "phase": "resend",
            "ok": error is None,
            "ms": elapsed,
        }
        if error is not None:
            record["error"] = error
        _write_log(config, record, error is None, now)
        if error is None:
            state_module.record_success(state, key, channel, now)
        else:
            entry["failed"][channel]["error"] = error
            entry["failed"][channel]["at"] = now.isoformat(timespec="seconds")
        state_module.save(home, state)


def _maybe_alert(*, state, config, senders, secret_reader, event, outcomes, clock):
    """推送连续失败到阈值，发一封告警邮件；一天最多一封。"""
    outcome = outcomes.get("push")
    if outcome is None or outcome["ok"]:
        return None
    now = clock()
    count = state_module.failure_count(state, "push")
    if count < ALERT_THRESHOLD or state_module.alert_sent_today(state, now):
        return None

    body = (
        f"手机推送连续失败 {count} 次，最近一次是「{event['event']}」："
        f"{outcome['error']}。\n"
        f"推送通道可能断了。这封邮件发得出来，说明邮件通道还能用。\n"
        f"日志：{config.log_path}"
    )
    error = None
    if not config.email.enabled:
        error = "邮件通道未启用"
    else:
        try:
            secret = secret_reader(SECRET_SERVICES[ALERT_CHANNEL])
            senders[ALERT_CHANNEL](
                config.email, ALERT_TITLE, body, secret)
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
    record = {
        "event": event["event"],
        "key": event["key"],
        "channel": ALERT_CHANNEL,
        "phase": "alert",
        "ok": error is None,
        "consecutive": count,
    }
    if error is not None:
        record["error"] = error
    _write_log(config, record, error is None, now)
    if error is None:
        state_module.mark_alert(state, now)
        state_module.save(config.home, state)
    return error is None


def run(argv=None, *, home=None, secret_reader=None, senders=None, clock=None):
    args = _parse_args(argv)
    secret_reader = secret_reader or config_module.read_keychain_secret
    senders = {**DEFAULT_SENDERS, **(senders or {})}
    clock = clock or _now

    try:
        event = _load_event(args.event_file)
        config = config_module.load_config(home)
        title, body = render_event(
            event["event"], event.get("data"), event.get("link"))
        channels = _effective_channels(event["event"], args.channel, config)
    except (EventError, config_module.ConfigError) as exc:
        print(f"error {exc}", file=sys.stderr)
        return EXIT_BAD_INPUT

    key = event["key"]
    state, state_error = state_module.load(config.home)
    if state_error:
        _write_log(
            config, {"phase": "state_error", "error": state_error}, False, clock())
    removed = state_module.prune(state, clock())
    if removed["sent"] or removed["pending"]:
        _write_log(config, {"phase": "prune", "removed": removed}, True, clock())

    if state_module.was_sent(state, key):
        state_module.save(config.home, state)
        _write_log(config, {
            "event": event["event"], "key": key,
            "phase": "skip", "reason": "duplicate", "ok": True,
        }, True, clock())
        print(json.dumps(
            {"key": key, "skipped": True, "results": []}, ensure_ascii=False))
        return EXIT_OK

    try:
        secrets = {
            name: secret_reader(SECRET_SERVICES[name]) for name in channels
        }
    except config_module.ConfigError as exc:
        print(f"error {exc}", file=sys.stderr)
        return EXIT_BAD_INPUT

    entry = state_module.ensure_pending(state, event, clock())
    state_module.save(config.home, state)
    attempted = [name for name in channels if name not in entry["delivered"]]

    outcomes = {}
    results = []
    for name in channels:
        if name in entry["delivered"]:
            outcomes[name] = {
                "ok": True, "ms": 0, "attempts": 0, "error": None,
            }
            results.append({"channel": name, "ok": True, "ms": 0})
            continue
        outcome = _deliver_channel(
            name, event=event, title=title, body=body, config=config,
            senders=senders, secret=secrets[name], state=state,
            home=config.home, clock=clock,
        )
        outcomes[name] = outcome
        results.append(
            {"channel": name, "ok": outcome["ok"], "ms": outcome["ms"]})

    now = clock()
    for name, outcome in outcomes.items():
        if name in entry["delivered"]:
            continue
        if outcome["ok"]:
            state_module.mark_delivered(state, key, name, now)
        else:
            state_module.mark_failed(
                state, key, name, outcome["error"], outcome["attempts"], now)
    state_module.finish(state, key, now)
    state_module.save(config.home, state)

    fallback = FALLBACK_EVENTS.get(event["event"])
    push_outcome = outcomes.get("push")
    if fallback and push_outcome is not None and not push_outcome["ok"]:
        fallback_outcome = outcomes.get(fallback)
        ok = bool(fallback_outcome and fallback_outcome["ok"])
        record = {
            "event": event["event"], "key": key,
            "channel": fallback, "phase": "fallback",
            "from": "push", "ok": ok,
        }
        if not ok:
            record["error"] = (
                fallback_outcome["error"] if fallback_outcome is not None
                else "邮件通道未启用")
        _write_log(config, record, ok, clock())

    alert_ok = None
    if args.channel is None:
        for name in attempted:
            if outcomes[name]["ok"]:
                _flush_pending(
                    state=state, home=config.home, config=config, channel=name,
                    senders=senders, secret_reader=secret_reader, clock=clock)
        alert_ok = _maybe_alert(
            state=state, config=config, senders=senders,
            secret_reader=secret_reader, event=event, outcomes=outcomes,
            clock=clock,
        )

    both_failed = (
        {"email", "push"} <= set(outcomes)
        and not outcomes["email"]["ok"]
        and not outcomes["push"]["ok"]
    )
    if both_failed or (push_outcome is not None and not push_outcome["ok"]
                       and alert_ok is False):
        _write_log(config, {
            "event": event["event"], "key": key,
            "phase": "outage", "message": "通道断了", "ok": False,
            "channels": ["email", "push"],
        }, False, clock())

    print(json.dumps(
        {"key": key, "skipped": False, "results": results},
        ensure_ascii=False,
    ))
    all_ok = all(item["ok"] for item in results)
    return EXIT_OK if all_ok else EXIT_CHANNEL_FAILED


def main(argv=None):
    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())
