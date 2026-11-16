"""通知模块命令行：python3 -m notifier send --event-file <路径>。

输入是一条通知事件 JSON；输出一行结果 JSON。退出码 0 全部送到，
1 至少一路失败，2 输入或配置错。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from . import config as config_module
from .channels import push as push_channel
from .channels import smtp as smtp_channel
from .templates import EVENTS, EventError, render_event

EXIT_OK = 0
EXIT_CHANNEL_FAILED = 1
EXIT_BAD_INPUT = 2

CHANNEL_ORDER = ("email", "push")
SECRET_SERVICES = {
    "email": config_module.KEYCHAIN_SMTP_PASSWORD,
    "push": config_module.KEYCHAIN_WECOM_WEBHOOK,
}
DEFAULT_SENDERS = {"email": smtp_channel.send, "push": push_channel.send}


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


def _write_log(config, record, ok):
    if config.log_level == "error" and ok:
        return
    line = {
        "ts": datetime.now().astimezone().isoformat(timespec="seconds"),
        **record,
    }
    config.log_path.parent.mkdir(parents=True, exist_ok=True)
    with config.log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line, ensure_ascii=False) + "\n")


def run(argv=None, *, home=None, secret_reader=None, senders=None):
    args = _parse_args(argv)
    secret_reader = secret_reader or config_module.read_keychain_secret
    senders = {**DEFAULT_SENDERS, **(senders or {})}

    try:
        event = _load_event(args.event_file)
        config = config_module.load_config(home)
        title, body = render_event(
            event["event"], event.get("data"), event.get("link"))
        channels = _effective_channels(event["event"], args.channel, config)
        secrets = {
            name: secret_reader(SECRET_SERVICES[name]) for name in channels
        }
    except (EventError, config_module.ConfigError) as exc:
        print(f"error {exc}", file=sys.stderr)
        return EXIT_BAD_INPUT

    results = []
    for name in channels:
        channel_config = config.email if name == "email" else config.push
        started = time.monotonic()
        error = None
        try:
            senders[name](channel_config, title, body, secrets[name])
        except Exception as exc:  # 这一路失败不影响另一路，退出码最后统一算
            error = f"{type(exc).__name__}: {exc}"
        elapsed = int((time.monotonic() - started) * 1000)
        ok = error is None
        results.append({"channel": name, "ok": ok, "ms": elapsed})
        record = {
            "event": event["event"],
            "key": event["key"],
            "channel": name,
            "ok": ok,
        }
        if error is not None:
            record["error"] = error
        _write_log(config, record, ok)

    # 去重（state.json）归 I-0120；本票先固定 skipped=false。
    print(json.dumps(
        {"key": event["key"], "skipped": False, "results": results},
        ensure_ascii=False,
    ))
    return EXIT_OK if all(result["ok"] for result in results) else EXIT_CHANNEL_FAILED


def main(argv=None):
    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())
