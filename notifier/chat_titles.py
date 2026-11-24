"""chat 标题：同一父工单的补缺口和拆票各用一个 chat。

标题格式固定为 `<前缀> <owner>/<repo>#<父工单号>`，见 docs/通知.md 的「bot chat」一节。
"""
from __future__ import annotations

CHAT_GAP = "补缺口"
CHAT_SPLIT = "拆票"


def chat_title(prefix: str, owner: str, repo: str, ticket: int) -> str:
    return f"{prefix} {owner}/{repo}#{ticket}"
