"""手机推送通道：企业微信群机器人 webhook。"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from ..config import PushConfig
from . import ChannelError

WEBHOOK_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send"
_URL_RE = re.compile(r"(https?://[^\s]+)")


def _linkify(line: str) -> str:
    # 企微 markdown 不保证裸链接可点，转成显式链接
    return _URL_RE.sub(lambda match: f"[{match.group(1)}]({match.group(1)})", line)


def _markdown(title: str, body: str) -> str:
    lines = body.splitlines() or [""]
    quoted = "\n".join(
        f"> {_linkify(line)}" if line else ">" for line in lines)
    return f"**{title}**\n{quoted}"


def send(config: PushConfig, title: str, body: str, secret: str) -> None:
    payload = {
        "msgtype": "markdown",
        "markdown": {"content": _markdown(title, body)},
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        WEBHOOK_URL + "?key=" + secret,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.timeout) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise ChannelError(f"HTTP {exc.code}") from exc
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}".replace(secret, "***")
        raise ChannelError(detail) from exc

    try:
        result = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ChannelError(f"响应不是合法 JSON：{text[:200]}") from exc
    if result.get("errcode") != 0:
        raise ChannelError(f"企业微信返回 {text[:200]}")
