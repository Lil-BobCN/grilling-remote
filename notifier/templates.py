"""通知事件的标题和正文模板。

措辞按 docs/通知.md 的「事件表」；改措辞要另开票。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .chat_titles import CHAT_GAP, CHAT_SPLIT, chat_title

EMAIL = "email"
PUSH = "push"
ORCA_BOT = "orca_bot"


def _proposal_links(data, link):
    parts = [link]
    comment_url = data.get("comment_url")
    if comment_url:
        parts.append(f"提案评论：{comment_url}")
    return "\n".join(parts)


def _gap_chat_title(data):
    return chat_title(CHAT_GAP, data['owner'], data['repo'], data['ticket'])


def _split_chat_title(data):
    return chat_title(CHAT_SPLIT, data['owner'], data['repo'], data['ticket'])


class EventError(Exception):
    """通知事件不合法。"""


@dataclass(frozen=True)
class EventSpec:
    channels: tuple[str, ...]
    required: tuple[str, ...]
    needs_link: bool
    render: Callable[[dict[str, Any], str], tuple[str, str]]


def _console_command(data):
    command = (
        f"node factory/bin/console.mjs open --owner {data['owner']} "
        f"--repo {data['repo']} --ticket {data['ticket']} --kind {data['kind']}"
    )
    if data.get("repo_dir"):
        return command + f" --repo-dir {data['repo_dir']}"
    if data.get("kind") == "gate":
        return command + " --repo-dir <客户仓>"
    return command


def _new_order(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 已进队列",
        f"回传校验通过，父工单和仓库已建好。不用动。{link}",
    )


def _reupload_map(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 回传地图已更新",
        f"地图按新回传换好了，待复查的票列在重传评论里。打开 Orca 看一眼。{link}",
    )


def _gap_proposal(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 等你补缺口（{data['question_count']} 题）",
        f"闸门题和推荐答案列好了。到 bot chat「{_gap_chat_title(data)}」里看题和答。\n"
        f"控制台兜底：\n{_console_command(data)}\n{_proposal_links(data, link)}",
    )


def _run_to_spec(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 工厂开始跑 to-spec",
        f"补缺口已点头，状态改成排队中。工厂会自动跑 to-spec，写完等你点头拆票，不用你手动跑；"
        f"一直失败时看父工单的 needs-info。{link}",
    )


def _split_proposal(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 等你点头拆票（{data['ticket_count']} 张）",
        f"接缝、票单、每票验收条件已备好。"
        f"到 bot chat「{_split_chat_title(data)}」里看票和点头。\n"
        f"控制台兜底：\n{_console_command(data)}\n{_proposal_links(data, link)}",
    )


def _need_answer(data, link):
    note = "" if data.get("repo_dir") else "\n（repoDir 没配，把 <客户仓> 换成客户仓路径）"
    return (
        f"{data['customer']} · {data['requirement']} · 等你答：{data['question']}",
        f"{data['question']}。推荐：{data['recommended']}。到 bot chat 里答题；控制台兜底：\n"
        f"{_console_command(data)}{note}\n{link}",
    )


def _incident(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 卡住：{data['reason']}",
        f"停在这条线上了。试过：{data['tried']}。到 bot chat 里说继续、换法或停。{link}",
    )


def _self_merged(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 自己合了主干",
        f"四样证据齐，验证队和评审都过。PR #{data['pr']} 已合主干，接下来部署。{link}",
    )


def _deployed(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 已部署",
        f"部署好了，地址：{data['address']}。客户那条微信待你发；"
        f"有问题到 bot chat 里说。{link}",
    )


def _needs_info(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 需要人看：状态对不上",
        f"标签和评论对不上，调度器没有猜。到 bot chat 里看，或打开父工单。{link}",
    )


def _ignite_timeout(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 点火超时",
        f"点火两分钟没回执，已打标签，不自动补点。{link}",
    )


def _import_failed(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 回传导入失败",
        f"导入没成：{data['tried']}。快照和订单已保留，处理后归档。{link}",
    )


def _daily_sample(data, link):
    parts = []
    for item in data["items"]:
        reference = f"PR #{item['pr']}"
        if item.get("url"):
            reference = f"[{reference}]({item['url']})"
        parts.append(
            f"{item['customer']} · {item['requirement']}（{reference}）")
    return f"昨天合了 {len(data['items'])} 单", "；".join(parts)


EVENTS: dict[str, EventSpec] = {
    "新单进队列": EventSpec((PUSH,), ("customer", "requirement"), True, _new_order),
    "重传地图已更新": EventSpec(
        (PUSH,), ("customer", "requirement"), True, _reupload_map),
    "补缺口提案": EventSpec(
        (PUSH, EMAIL, ORCA_BOT),
        ("customer", "requirement", "question_count", "owner", "repo", "ticket", "kind"),
        True, _gap_proposal),
    "该跑 to-spec": EventSpec(
        (PUSH, EMAIL), ("customer", "requirement"), True, _run_to_spec),
    "拆票提案": EventSpec(
        (PUSH, EMAIL, ORCA_BOT),
        ("customer", "requirement", "ticket_count", "owner", "repo", "ticket", "kind"),
        True, _split_proposal),
    "需要你答": EventSpec(
        (PUSH, EMAIL, ORCA_BOT),
        ("customer", "requirement", "question", "recommended", "owner", "repo", "ticket", "kind"),
        True, _need_answer),
    "出事": EventSpec(
        (PUSH, EMAIL, ORCA_BOT), ("customer", "requirement", "reason", "tried"),
        True, _incident),
    "自己合并": EventSpec(
        (PUSH,), ("customer", "requirement", "pr"), True, _self_merged),
    "部署完成": EventSpec(
        (PUSH, ORCA_BOT), ("customer", "requirement", "address"), True, _deployed),
    "needs-info": EventSpec(
        (PUSH, ORCA_BOT), ("customer", "requirement"), True, _needs_info),
    "点火超时": EventSpec(
        (EMAIL,), ("customer", "requirement"), True, _ignite_timeout),
    "import_failed": EventSpec(
        (PUSH, EMAIL), ("customer", "requirement", "reason", "tried"),
        True, _import_failed),
    "每日抽样": EventSpec((PUSH,), ("date", "items"), False, _daily_sample),
}

_STRING_FIELDS = {
    "customer", "requirement", "question", "recommended", "reason",
    "tried", "address", "date", "owner", "repo", "kind", "repo_dir",
}
_INT_FIELDS = {"question_count", "ticket_count", "pr", "ticket"}


def _validate_items(event, value):
    if not isinstance(value, list):
        raise EventError(f"事件「{event}」的 data.items 必须是数组")
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise EventError(f"事件「{event}」的 data.items[{index}] 必须是对象")
        for field in ("customer", "requirement"):
            field_value = item.get(field)
            if not isinstance(field_value, str) or not field_value.strip():
                raise EventError(
                    f"事件「{event}」的 data.items[{index}].{field} 必须是非空字符串")
        pr = item.get("pr")
        if isinstance(pr, bool) or not isinstance(pr, int):
            raise EventError(f"事件「{event}」的 data.items[{index}].pr 必须是整数")
        url = item.get("url")
        if url is not None and (
                not isinstance(url, str) or not url.strip()):
            raise EventError(
                f"事件「{event}」的 data.items[{index}].url 必须是非空字符串")


def _validate(event: str, spec: EventSpec, data: dict[str, Any], link: str | None):
    for name in spec.required:
        if name not in data:
            raise EventError(f"事件「{event}」缺少 data.{name}")
    for name in spec.required:
        value = data[name]
        if name in _STRING_FIELDS:
            if not isinstance(value, str) or not value.strip():
                raise EventError(f"事件「{event}」的 data.{name} 必须是非空字符串")
            if name == "kind" and value not in ("gap", "split", "gate"):
                raise EventError(f"事件「{event}」的 data.kind 只能是 gap、split、gate")
        elif name in _INT_FIELDS:
            if isinstance(value, bool) or not isinstance(value, int):
                raise EventError(f"事件「{event}」的 data.{name} 必须是整数")
        elif name == "items":
            _validate_items(event, value)
    repo_dir = data.get("repo_dir")
    if repo_dir is not None and (not isinstance(repo_dir, str) or not repo_dir.strip()):
        raise EventError(f"事件「{event}」的 data.repo_dir 必须是非空字符串")
    comment_url = data.get("comment_url")
    if comment_url is not None and (
            not isinstance(comment_url, str) or not comment_url.strip()):
        raise EventError(f"事件「{event}」的 data.comment_url 必须是非空字符串")
    if spec.needs_link and (not isinstance(link, str) or not link.strip()):
        raise EventError(f"事件「{event}」缺少 link")
    days = data.get("days_waited")
    if days is not None:
        if isinstance(days, bool) or not isinstance(days, int) or days < 0:
            raise EventError(f"事件「{event}」的 data.days_waited 必须是非负整数")


def render_event(event: str, data: Any, link: str | None) -> tuple[str, str]:
    spec = EVENTS.get(event)
    if spec is None:
        raise EventError(
            f"未知事件「{event}」，按 docs/通知.md 的「事件表」的 13 类")
    if not isinstance(data, dict):
        raise EventError("data 必须是对象")
    _validate(event, spec, data, link)
    title, body = spec.render(data, link or "")
    days = data.get("days_waited")
    if days:
        body += f"\n已等 {days} 天。"
    return title, body
