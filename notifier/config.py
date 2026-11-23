"""通知模块配置：读 ~/.grilling/notifier/config.json 和登录钥匙串。

密钥不进配置文件；按 I-0115 的约定只从钥匙串读。
"""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

DEFAULT_HOME = "~/.grilling/notifier"
KEYCHAIN_ACCOUNT = "notifier"
KEYCHAIN_SMTP_PASSWORD = "afkfactory-notifier.smtp-password"
KEYCHAIN_WECOM_WEBHOOK = "afkfactory-notifier.wecom-webhook"

LOG_LEVELS = ("info", "error")
RETRY_DEFAULT_ATTEMPTS = 3
RETRY_DEFAULT_INTERVAL_SECONDS = 30.0
ORCA_DEFAULT_COMMAND = "orca"


class ConfigError(Exception):
    """配置或密钥不可用。"""


@dataclass(frozen=True)
class EmailConfig:
    enabled: bool
    recipient: str
    sender: str
    host: str
    port: int
    timeout: float


@dataclass(frozen=True)
class PushConfig:
    enabled: bool
    timeout: float


@dataclass(frozen=True)
class OrcaBotConfig:
    enabled: bool
    bot: str
    timeout: float
    command: str


@dataclass(frozen=True)
class RetryConfig:
    attempts: int
    interval_seconds: float


@dataclass(frozen=True)
class Config:
    home: Path
    log_path: Path
    log_level: str
    email: EmailConfig
    push: PushConfig
    orca_bot: OrcaBotConfig
    retry: RetryConfig


def notifier_home(home=None) -> Path:
    raw = home if home is not None else os.environ.get("NOTIFIER_HOME", DEFAULT_HOME)
    return Path(raw).expanduser()


def _require_mapping(value, where):
    if not isinstance(value, dict):
        raise ConfigError(f"{where} 必须是对象")
    return value


def _require_str(mapping, key, where):
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{where}.{key} 必须是非空字符串")
    return value


def _require_bool(mapping, key, where):
    value = mapping.get(key)
    if not isinstance(value, bool):
        raise ConfigError(f"{where}.{key} 必须是 true 或 false")
    return value


def _require_number(mapping, key, where):
    value = mapping.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise ConfigError(f"{where}.{key} 必须是大于 0 的数")
    return float(value)


def _require_port(mapping, where):
    value = mapping.get("port")
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value < 65536:
        raise ConfigError(f"{where}.port 必须是 1 到 65535 的整数")
    return value


def _orca_bot_config(raw) -> OrcaBotConfig:
    """orca_bot 可以整段不写，等于关闭；开着才要求 bot 和超时。"""
    if raw is None:
        return OrcaBotConfig(
            enabled=False, bot="", timeout=0.0, command=ORCA_DEFAULT_COMMAND)
    mapping = _require_mapping(raw, "channels.orca_bot")
    enabled = _require_bool(mapping, "enabled", "channels.orca_bot")
    command = mapping.get("command", ORCA_DEFAULT_COMMAND)
    if not isinstance(command, str) or not command.strip():
        raise ConfigError("channels.orca_bot.command 必须是非空字符串")
    if not enabled:
        bot = mapping.get("bot", "")
        timeout = mapping.get("timeout_seconds", 0)
        return OrcaBotConfig(
            enabled=False,
            bot=bot if isinstance(bot, str) else "",
            timeout=float(timeout) if isinstance(timeout, (int, float))
            and not isinstance(timeout, bool) and timeout > 0 else 0.0,
            command=command,
        )
    return OrcaBotConfig(
        enabled=True,
        bot=_require_str(mapping, "bot", "channels.orca_bot"),
        timeout=_require_number(mapping, "timeout_seconds", "channels.orca_bot"),
        command=command,
    )


def load_config(home=None) -> Config:
    home_path = notifier_home(home)
    path = home_path / "config.json"
    if not path.is_file():
        raise ConfigError(
            f"找不到配置文件 {path}；先把 notifier/config.example.json "
            "复制过去，填上收件地址")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError(f"配置文件 {path} 不是合法 JSON：{exc}") from exc
    except OSError as exc:
        raise ConfigError(f"读不到配置文件 {path}：{exc}") from exc

    root = _require_mapping(raw, "配置")
    channels = _require_mapping(root.get("channels"), "channels")
    email = _require_mapping(channels.get("email"), "channels.email")
    push = _require_mapping(channels.get("push"), "channels.push")
    orca_bot = _orca_bot_config(channels.get("orca_bot"))
    log = _require_mapping(root.get("log", {}), "log")
    log_level = log.get("level", "info")
    if log_level not in LOG_LEVELS:
        raise ConfigError(f"log.level 只能是 {' 或 '.join(LOG_LEVELS)}")
    retry = _require_mapping(root.get("retry", {}), "retry")
    attempts = retry.get("attempts", RETRY_DEFAULT_ATTEMPTS)
    if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 1:
        raise ConfigError("retry.attempts 必须是大于 0 的整数")
    interval = retry.get("interval_seconds", RETRY_DEFAULT_INTERVAL_SECONDS)
    if (isinstance(interval, bool) or not isinstance(interval, (int, float))
            or interval < 0):
        raise ConfigError("retry.interval_seconds 必须是大于等于 0 的数")

    return Config(
        home=home_path,
        log_path=home_path / "notify.log",
        log_level=log_level,
        email=EmailConfig(
            enabled=_require_bool(email, "enabled", "channels.email"),
            recipient=_require_str(email, "to", "channels.email"),
            sender=_require_str(email, "from", "channels.email"),
            host=_require_str(email, "host", "channels.email"),
            port=_require_port(email, "channels.email"),
            timeout=_require_number(email, "timeout_seconds", "channels.email"),
        ),
        push=PushConfig(
            enabled=_require_bool(push, "enabled", "channels.push"),
            timeout=_require_number(push, "timeout_seconds", "channels.push"),
        ),
        orca_bot=orca_bot,
        retry=RetryConfig(
            attempts=attempts,
            interval_seconds=float(interval),
        ),
    )


def read_keychain_secret(service: str, account: str = KEYCHAIN_ACCOUNT) -> str:
    try:
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password",
             "-a", account, "-s", service, "-w"],
            capture_output=True, text=True, timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise ConfigError(f"读钥匙串失败：{exc}") from exc
    if result.returncode != 0:
        raise ConfigError(
            f"钥匙串缺少条目 {service}（账户 {account}），"
            "先按 I-0115 的约定写入")
    secret = result.stdout.rstrip("\n")
    if not secret:
        raise ConfigError(f"钥匙串条目 {service}（账户 {account}）是空的")
    return secret
