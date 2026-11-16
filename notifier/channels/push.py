"""手机推送通道：企业微信群机器人 webhook。"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from ..config import PushConfig
from . import ChannelError

WEBHOOK_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send"
CONTENT_LIMIT = 4096  # 企业微信 markdown 单条上限，字节
CONTINUATION = "（续"  # 拆条时后续消息的标题后缀
_MD_LINK_RE = re.compile(r"\[[^\]]*\]\([^)\s]*\)")
_BARE_URL_RE = re.compile(
    r"https?://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+")
_TRAILING_PUNCT = ".,;:!?"
SPLIT_MARGIN = 64  # 给「（续 1/2）」这类后缀留的字节余量


def _wrap(match):
    raw = match.group(0)
    url = raw.rstrip(_TRAILING_PUNCT)
    tail = raw[len(url):]
    return f"[{url}]({url}){tail}"


def _linkify(line: str) -> str:
    # 企微 markdown 不保证裸链接可点，转成显式链接；已经是 [文字](url) 的不动
    parts = []
    last = 0
    for match in _MD_LINK_RE.finditer(line):
        parts.append(_BARE_URL_RE.sub(_wrap, line[last:match.start()]))
        parts.append(match.group(0))
        last = match.end()
    parts.append(_BARE_URL_RE.sub(_wrap, line[last:]))
    return "".join(parts)


def _markdown(title: str, body: str) -> str:
    lines = body.splitlines() or [""]
    quoted = "\n".join(
        f"> {_linkify(line)}" if line else ">" for line in lines)
    return f"**{title}**\n{quoted}"


def _fits(title: str, body: str, limit: int) -> bool:
    return len(_markdown(title, body).encode("utf-8")) <= limit


def _hard_split(piece: str, fits):
    start = 0
    while start < len(piece):
        low, high = start + 1, len(piece)
        best = start + 1
        while low <= high:
            middle = (low + high) // 2
            if fits(piece[start:middle]):
                best = middle
                low = middle + 1
            else:
                high = middle - 1
        yield piece[start:best]
        start = best


def _pieces(body: str, fits_piece):
    pieces = []
    for line in body.splitlines() or [""]:
        if fits_piece(line):
            pieces.append(line)
            continue
        for segment in _split_on(line, "；"):
            if fits_piece(segment):
                pieces.append(segment)
            else:
                pieces.extend(_hard_split(segment, fits_piece))
    return pieces


def _split_on(text: str, separator: str):
    """按分隔符切开，分隔符留在前一段末尾。"""
    parts = text.split(separator)
    return [
        part + separator if index < len(parts) - 1 else part
        for index, part in enumerate(parts)
    ]


def _chunks(title: str, body: str, limit: int):
    continuation_title = f"{title}{CONTINUATION}）"
    budget = limit - SPLIT_MARGIN

    def fits_piece(piece):
        return _fits(continuation_title, piece, budget)

    chunks = []
    current: list[str] = []
    for piece in _pieces(body, fits_piece):
        candidate = current + [piece]
        if current and not fits_piece("\n".join(candidate)):
            chunks.append("\n".join(current))
            current = [piece]
        else:
            current = candidate
    if current:
        chunks.append("\n".join(current))
    return chunks


def _contents(title: str, body: str, limit: int = CONTENT_LIMIT):
    if _fits(title, body, limit):
        return [_markdown(title, body)]
    chunks = _chunks(title, body, limit)
    total = len(chunks)
    contents = []
    for index, chunk in enumerate(chunks, 1):
        chunk_title = (
            title if index == 1 else f"{title}{CONTINUATION}{index}/{total}）")
        contents.append(_markdown(chunk_title, chunk))
    return contents


def _post(content: str, secret: str, timeout: float) -> None:
    payload = {
        "msgtype": "markdown",
        "markdown": {"content": content},
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        WEBHOOK_URL + "?key=" + secret,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
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


def send(config: PushConfig, title: str, body: str, secret: str) -> None:
    for content in _contents(title, body):
        _post(content, secret, config.timeout)
