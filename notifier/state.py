"""已推标记、连续失败计数和待补发事件。

`state.json` 放在通知模块运行目录，按 `key` 记送达情况：
全部通道送到后进 `sent`，同一 key 再来直接跳过；
有通道失败时留在 `pending`，等通道恢复后补发。
写文件用临时文件加 `os.replace`，进程崩在写一半时最多留下一条旧状态。
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

STATE_FILE = "state.json"
STATE_VERSION = 1
RETENTION_DAYS = 7


def empty_state() -> dict:
    return {
        "v": STATE_VERSION,
        "sent": {},
        "pending": {},
        "channel_failures": {},
        "alert": {},
    }


def _normalize(data: dict) -> dict:
    data.setdefault("sent", {})
    data.setdefault("pending", {})
    data.setdefault("channel_failures", {})
    data.setdefault("alert", {})
    return data


def state_path(home: Path) -> Path:
    return Path(home) / STATE_FILE


def load(home: Path) -> tuple[dict, str | None]:
    """读状态。返回 (状态, 错误说明)；读不出来就从头开始，调用方写日志。"""
    path = state_path(home)
    if not path.is_file():
        return empty_state(), None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return empty_state(), f"读不到状态文件 {path}：{exc}"
    if not isinstance(data, dict) or data.get("v") != STATE_VERSION:
        return empty_state(), f"状态文件 {path} 版本不认识"
    for section in ("sent", "pending", "channel_failures", "alert"):
        if not isinstance(data.get(section), dict):
            return empty_state(), f"状态文件 {path} 的 {section} 不是对象"
    return _normalize(data), None


def save(home: Path, state: dict) -> None:
    """原子写：先写同目录临时文件，fsync 后再 replace。"""
    path = state_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent), prefix=".state-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=1, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    try:
        dir_fd = os.open(path.parent, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    except OSError:
        pass
    finally:
        os.close(dir_fd)


def _parse_time(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.astimezone()
    return parsed


def _timestamp(now: datetime) -> str:
    return now.isoformat(timespec="seconds")


def _entry_time(entry: dict) -> datetime | None:
    for field in ("failed_at", "created_at", "at"):
        parsed = _parse_time(entry.get(field))
        if parsed is not None:
            return parsed
    failed = entry.get("failed")
    if isinstance(failed, dict) and failed:
        return _parse_time(next(iter(failed.values())).get("at"))
    return None


def prune(state: dict, now: datetime) -> dict:
    """丢掉超过保留窗口的已推标记和待补发事件。"""
    cutoff = now - timedelta(days=RETENTION_DAYS)
    removed = {"sent": 0, "pending": 0}
    for section in ("sent", "pending"):
        for key, entry in list(state[section].items()):
            at = _entry_time(entry) if isinstance(entry, dict) else None
            if at is None or at < cutoff:
                del state[section][key]
                removed[section] += 1
    return removed


def was_sent(state: dict, key: str) -> bool:
    return key in state["sent"]


def ensure_pending(state: dict, event: dict, now: datetime) -> dict:
    """写前留档：发送前先落一条待补发记录，崩溃后最多重复一次。"""
    key = event["key"]
    entry = state["pending"].get(key)
    if entry is None:
        entry = {
            "event": event,
            "created_at": _timestamp(now),
            "delivered": {},
            "failed": {},
        }
        state["pending"][key] = entry
    else:
        entry["event"] = event
    return entry


def mark_delivered(state: dict, key: str, channel: str, now: datetime) -> None:
    entry = state["pending"].get(key)
    if entry is None:
        return
    entry["delivered"][channel] = _timestamp(now)
    entry["failed"].pop(channel, None)


def mark_failed(state: dict, key: str, channel: str, error: str,
                attempts: int, now: datetime) -> None:
    entry = state["pending"].get(key)
    if entry is None:
        return
    entry["failed"][channel] = {
        "error": error,
        "attempts": attempts,
        "at": _timestamp(now),
    }
    entry["failed_at"] = _timestamp(now)


def finish(state: dict, key: str, now: datetime) -> None:
    """所有通道都送到后从 pending 移进 sent。"""
    entry = state["pending"].get(key)
    if entry is not None:
        _move_to_sent(state, key, entry, now)


def record_success(state: dict, key: str, channel: str, now: datetime) -> None:
    """补发成功：记这一路，全部送到就进 sent。"""
    entry = state["pending"].get(key)
    if entry is None:
        return
    mark_delivered(state, key, channel, now)
    entry["failed"].pop(channel, None)
    _move_to_sent(state, key, entry, now)


def _move_to_sent(state: dict, key: str, entry: dict, now: datetime) -> None:
    if entry["failed"]:
        return
    state["sent"][key] = {
        "at": _timestamp(now),
        "event": entry["event"].get("event"),
        "channels": sorted(entry["delivered"]),
    }
    del state["pending"][key]


def failure_count(state: dict, channel: str) -> int:
    value = state["channel_failures"].get(channel, 0)
    return value if isinstance(value, int) else 0


def set_failure_count(state: dict, channel: str, value: int) -> None:
    state["channel_failures"][channel] = value


def alert_sent_today(state: dict, now: datetime) -> bool:
    return state["alert"].get("last_date") == now.date().isoformat()


def mark_alert(state: dict, now: datetime) -> None:
    state["alert"]["last_date"] = now.date().isoformat()
    state["alert"]["last_at"] = _timestamp(now)
