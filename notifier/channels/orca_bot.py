"""orca_bot 通道：叫醒 Orca 工作台 bot，把消息送进对应父工单的 chat。

chat 标题固定：`补缺口 <owner>/<repo>#<父工单号>`、`拆票 <owner>/<repo>#<父工单号>`。
提案消息进各自的 chat；非提案消息先进拆票 chat，没有就进补缺口 chat，都没有进 Home Chat。
"""
from __future__ import annotations

import json
import re
import subprocess

from ..chat_titles import CHAT_GAP, CHAT_SPLIT, chat_title
from ..config import OrcaBotConfig
from . import ChannelError

PROPOSAL_CHATS = {
    "补缺口提案": CHAT_GAP,
    "拆票提案": CHAT_SPLIT,
}
_ISSUE_URL_RE = re.compile(
    r"^https?://github\.com/([^/\s]+)/([^/\s]+)/issues/(\d+)(?:[/?#].*)?$")


def _run(config: OrcaBotConfig, args) -> dict:
    try:
        result = subprocess.run(
            [config.command, *args],
            capture_output=True, text=True, timeout=config.timeout,
        )
    except FileNotFoundError as exc:
        raise ChannelError(f"找不到 orca 命令 {config.command}") from exc
    except subprocess.TimeoutExpired as exc:
        raise ChannelError(f"orca 命令超时（{config.timeout:g} 秒）") from exc
    except OSError as exc:
        raise ChannelError(f"跑不动 orca 命令 {config.command}：{exc}") from exc

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = None
    if result.returncode != 0 or not (isinstance(payload, dict) and payload.get("ok")):
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            message = str(error.get("message") or error.get("code") or "")
        elif error:
            message = str(error)
        else:
            message = result.stderr.strip()
        raise ChannelError(
            f"orca {args[0]} {args[1]} 失败：{message or f'退出码 {result.returncode}'}")
    return payload


def _parent_identity(event: dict):
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    owner = data.get("owner")
    repo = data.get("repo")
    ticket = data.get("ticket")
    if (isinstance(owner, str) and owner.strip()
            and isinstance(repo, str) and repo.strip()
            and isinstance(ticket, int) and not isinstance(ticket, bool)):
        return owner.strip(), repo.strip(), ticket
    match = _ISSUE_URL_RE.match(str(event.get("link") or "").strip())
    if match:
        return match.group(1), match.group(2), int(match.group(3))
    return None


def _open_chats(config: OrcaBotConfig) -> list[dict]:
    payload = _run(config, ["bot", "chats", "--bot", config.bot, "--json"])
    result = payload.get("result")
    rows = result.get("chats") if isinstance(result, dict) else None
    if not isinstance(rows, list):
        raise ChannelError("orca bot chats 没有返回 chats 数组")
    return [
        row for row in rows
        if isinstance(row, dict) and not row.get("closed")
    ]


def _find_chat(chats: list[dict], title: str):
    for row in chats:
        if row.get("title") == title and isinstance(row.get("id"), str):
            return row["id"]
    return None


def send(config: OrcaBotConfig, title: str, body: str, secret=None, event=None):
    if not isinstance(event, dict):
        raise ChannelError("orca_bot 通道缺少事件上下文")

    subject = title
    identity = _parent_identity(event)
    if identity is not None:
        owner, repo, ticket = identity
        chats = _open_chats(config)
        proposal = PROPOSAL_CHATS.get(event.get("event"))
        if proposal is not None:
            subject = chat_title(proposal, owner, repo, ticket)
            chat = _find_chat(chats, subject)
            chat_args = ["--chat", chat] if chat else ["--chat", "new"]
        else:
            chat_args = []
            for prefix in (CHAT_SPLIT, CHAT_GAP):
                candidate = chat_title(prefix, owner, repo, ticket)
                chat = _find_chat(chats, candidate)
                if chat:
                    subject = candidate
                    chat_args = ["--chat", chat]
                    break
        parent_url = f"https://github.com/{owner}/{repo}/issues/{ticket}"
        if parent_url not in body:
            body = f"{body}\n父工单：{parent_url}"
        comment_url = (
            event["data"].get("comment_url")
            if isinstance(event.get("data"), dict) else None
        )
        if (isinstance(comment_url, str) and comment_url.strip()
                and comment_url not in body):
            body = f"{body}\n提案评论：{comment_url.strip()}"
    else:
        chat_args = []

    _run(config, [
        "orchestration", "send",
        "--to", f"bot:{config.bot}",
        "--type", "handoff",
        "--subject", subject,
        "--body", body,
        *chat_args,
        "--json",
    ])
