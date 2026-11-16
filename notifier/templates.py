"""通知事件的标题和正文模板。

措辞按 docs/通知与事件表.md 第二节；改措辞要另开票。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

EMAIL = "email"
PUSH = "push"


class EventError(Exception):
    """通知事件不合法。"""


@dataclass(frozen=True)
class EventSpec:
    channels: tuple[str, ...]
    required: tuple[str, ...]
    needs_link: bool
    render: Callable[[dict[str, Any], str], tuple[str, str]]


def _new_order(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 已进队列",
        f"回传校验通过，父工单和仓库已建好。不用动。{link}",
    )


def _gap_proposal(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 等你补缺口（{data['question_count']} 题）",
        f"闸门题和推荐答案列好了。打开 Orca 答一轮。{link}",
    )


def _run_to_spec(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 该跑 to-spec 了",
        f"补缺口已点头，状态改成排队中。手动跑 to-spec，写完再拆票。{link}",
    )


def _split_proposal(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 等你点头拆票（{data['ticket_count']} 张）",
        f"接缝、票单、每票验收条件已备好。打开 Orca 扫一眼。{link}",
    )


def _need_answer(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 等你答：{data['question']}",
        f"{data['question']}。推荐：{data['recommended']}。打开 Orca 答。{link}",
    )


def _incident(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 卡住：{data['reason']}",
        f"停在这条线上了。试过：{data['tried']}。来处理：继续、换法或停。{link}",
    )


def _self_merged(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 自己合了主干",
        f"四样证据齐，验证队和评审都过。PR #{data['pr']} 已合主干，接下来部署。{link}",
    )


def _deployed(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 已部署",
        f"部署好了，地址：{data['address']}。客户那条微信待你发。{link}",
    )


def _needs_info(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 需要人看：状态对不上",
        f"标签和评论对不上，调度器没有猜。看一眼父工单。{link}",
    )


def _ignite_timeout(data, link):
    return (
        f"{data['customer']} · {data['requirement']} · 点火超时",
        f"点火两分钟没回执，已打标签，不自动补点。{link}",
    )


def _daily_sample(data, link):
    lines = "；".join(
        f"{item['customer']} · {item['requirement']}（PR #{item['pr']}）"
        for item in data["items"]
    )
    return f"昨天合了 {len(data['items'])} 单", lines


EVENTS: dict[str, EventSpec] = {
    "新单进队列": EventSpec((PUSH,), ("customer", "requirement"), True, _new_order),
    "补缺口提案": EventSpec(
        (PUSH,), ("customer", "requirement", "question_count"), True, _gap_proposal),
    "该跑 to-spec": EventSpec(
        (PUSH,), ("customer", "requirement"), True, _run_to_spec),
    "拆票提案": EventSpec(
        (PUSH,), ("customer", "requirement", "ticket_count"), True, _split_proposal),
    "需要你答": EventSpec(
        (PUSH,), ("customer", "requirement", "question", "recommended"),
        True, _need_answer),
    "出事": EventSpec(
        (PUSH, EMAIL), ("customer", "requirement", "reason", "tried"),
        True, _incident),
    "自己合并": EventSpec(
        (PUSH,), ("customer", "requirement", "pr"), True, _self_merged),
    "部署完成": EventSpec(
        (PUSH,), ("customer", "requirement", "address"), True, _deployed),
    "needs-info": EventSpec(
        (PUSH,), ("customer", "requirement"), True, _needs_info),
    "点火超时": EventSpec(
        (EMAIL,), ("customer", "requirement"), True, _ignite_timeout),
    "每日抽样": EventSpec((PUSH,), ("date", "items"), False, _daily_sample),
}

_STRING_FIELDS = {
    "customer", "requirement", "question", "recommended", "reason",
    "tried", "address", "date",
}
_INT_FIELDS = {"question_count", "ticket_count", "pr"}


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


def _validate(event: str, spec: EventSpec, data: dict[str, Any], link: str | None):
    for name in spec.required:
        if name not in data:
            raise EventError(f"事件「{event}」缺少 data.{name}")
    for name in spec.required:
        value = data[name]
        if name in _STRING_FIELDS:
            if not isinstance(value, str) or not value.strip():
                raise EventError(f"事件「{event}」的 data.{name} 必须是非空字符串")
        elif name in _INT_FIELDS:
            if isinstance(value, bool) or not isinstance(value, int):
                raise EventError(f"事件「{event}」的 data.{name} 必须是整数")
        elif name == "items":
            _validate_items(event, value)
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
            f"未知事件「{event}」，按 docs/通知与事件表.md 第二节的 11 类")
    if not isinstance(data, dict):
        raise EventError("data 必须是对象")
    _validate(event, spec, data, link)
    title, body = spec.render(data, link or "")
    days = data.get("days_waited")
    if days:
        body += f"\n已等 {days} 天。"
    return title, body
