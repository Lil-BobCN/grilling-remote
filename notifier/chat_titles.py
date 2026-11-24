"""chat 标题：同一父工单的补缺口和拆票各用一个 chat。

标题格式固定为 `<前缀> <owner>/<repo>#<父工单号>`，见 docs/通知.md 的「bot chat」一节。
"""
from __future__ import annotations

CHAT_GAP = "补缺口"
CHAT_SPLIT = "拆票"
BOT_CHAT_TITLE_PREFIX = "your owner's agent: "


def chat_title(prefix: str, owner: str, repo: str, ticket: int) -> str:
    return f"{prefix} {owner}/{repo}#{ticket}"


def chat_title_matches(actual, expected: str) -> bool:
    """真机 bot chat 的标题会带 `your owner's agent: ` 前缀，两种都算命中。"""
    if not isinstance(actual, str):
        return False
    return actual == expected or actual == f"{BOT_CHAT_TITLE_PREFIX}{expected}"
