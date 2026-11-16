"""通知事件的数据来源：前一天合并记录、PR head 的 gate 行。

只做一次只读查询，不轮询，不判断后续状态。见 docs/通知模块边界.md 第七节。
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from typing import Callable
from urllib.parse import quote

CUSTOMER_RE = re.compile(r"^- 客户简称：(.*)$", re.MULTILINE)
REQUIREMENT_RE = re.compile(r"^- 需求名：(.*)$", re.MULTILINE)
TICKET_BRANCH_RE = re.compile(r"(?:^|/)issue-(\d+)$")
GATE_PREFIX = "问："
ANSWER_PREFIX = "答："
ANSWERED_RESULTS = ("answered", "parked")
RECOMMEND_PREFIX = "推荐："
MISSING_RECOMMEND = "未写推荐"

Runner = Callable[[list[str]], str]


class SourceError(Exception):
    """查不到数据，或数据格式不对。"""


def gh(args: list[str], timeout: int = 60) -> str:
    """跑一次 gh，返回 stdout；失败抛 SourceError。"""
    try:
        result = subprocess.run(
            ["gh", *args], capture_output=True, text=True, timeout=timeout)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise SourceError(f"跑 gh 失败：{exc}") from exc
    if result.returncode != 0:
        raise SourceError(
            f"gh {' '.join(args)} 失败：{result.stderr.strip()}")
    return result.stdout


def _first_line(regex, body):
    match = regex.search(body or "")
    return match.group(1).strip() if match else None


def _json(text, what):
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise SourceError(f"{what} 返回不是合法 JSON：{exc}") from exc


def ticket_from_branch(ref):
    match = TICKET_BRANCH_RE.search(ref or "")
    return int(match.group(1)) if match else None


def local_day_window(day: str, tz=None):
    """把 YYYY-MM-DD 换成当地时区当天 [00:00, 次日 00:00)。"""
    try:
        target = Date.fromisoformat(day)
    except ValueError as exc:
        raise SourceError(f"日期不合法（要 YYYY-MM-DD）：{day}") from exc
    zone = tz or datetime.now().astimezone().tzinfo
    start = datetime.combine(target, time(0), zone)
    return start, start + timedelta(days=1)


def _merged_at(pull):
    return datetime.fromisoformat(
        pull["mergedAt"].replace("Z", "+00:00"))


def list_merged_pulls(repo: str, day: str, *, run: Runner = gh, tz=None):
    """读某一天（当地时区 00:00 到 24:00）合进主干的 PR。"""
    start, end = local_day_window(day, tz)
    # GitHub 的 merged: 查询按 UTC 日期算，本地一天会跨两个 UTC 日期
    query_days = {
        start.astimezone(timezone.utc).date(),
        (end - timedelta(microseconds=1)).astimezone(timezone.utc).date(),
    }
    pulls = {}
    for query_day in sorted(query_days):
        raw = run([
            "pr", "list", "--repo", repo, "--state", "merged",
            "--search", f"merged:{query_day.isoformat()}", "--limit", "200",
            "--json", "number,title,url,mergedAt,headRefName",
        ])
        for pull in _json(raw, "gh pr list"):
            pulls[pull["number"]] = pull
    selected = [
        pull for pull in pulls.values() if start <= _merged_at(pull) < end
    ]
    return sorted(selected, key=_merged_at)


def _issue_fields(repo, number, run):
    raw = run([
        "issue", "view", str(number), "--repo", repo, "--json", "title,body",
    ])
    issue = _json(raw, f"gh issue view {number}")
    return (
        _first_line(CUSTOMER_RE, issue.get("body")),
        _first_line(REQUIREMENT_RE, issue.get("body")),
        issue.get("title"),
    )


def build_daily_items(repo: str, day: str, customer_fallback=None, *,
                      run: Runner = gh, tz=None):
    """组装「每日抽样」的 items；没有合并就返回空数组。

    客户简称和需求名优先读工单正文的 `- 客户简称：` / `- 需求名：`；
    读不到时用 customer_fallback 和工单标题，再退到 PR 标题。
    """
    cache = {}
    items = []
    for pull in list_merged_pulls(repo, day, run=run, tz=tz):
        ticket = ticket_from_branch(pull.get("headRefName"))
        customer = requirement = issue_title = None
        if ticket is not None:
            if ticket not in cache:
                cache[ticket] = _issue_fields(repo, ticket, run)
            customer, requirement, issue_title = cache[ticket]
        customer = customer or customer_fallback
        requirement = requirement or issue_title or pull.get("title")
        if not customer or not requirement:
            raise SourceError(
                f"PR #{pull['number']} 找不到客户简称或需求名；"
                "用 --customer 补客户简称")
        items.append({
            "customer": customer,
            "requirement": requirement,
            "pr": pull["number"],
            "url": pull["url"],
        })
    return items


@dataclass(frozen=True)
class GateRow:
    ts: str
    question: str
    recommended: str


def parse_gate_rows(text: str):
    """从 trail 的 TSV 里挑出待答的 gate 行。

    行格式按 factory-skills/pstack：六列 ts/phase/decision/why/evidence/result。
    decision 以「问：」开头、result=open 的行才算等待回答。
    推荐答案写在 decision 或 why 的「推荐：」后面；没有就写「未写推荐」。

    trail 是追加式的，问题行不会改。后面的 `答：` 行按出现顺序配给最早的
    未答问题（result=answered 或 parked），配上后不再提醒。
    """
    pending = []
    for line in text.splitlines():
        if not line.strip():
            continue
        cells = line.split("\t")
        if len(cells) < 6:
            continue
        ts, phase, decision, why, _evidence, result = (
            cell.strip() for cell in cells[:6])
        if phase != "gate":
            continue
        if decision.startswith(ANSWER_PREFIX) and result in ANSWERED_RESULTS:
            if pending:
                pending.pop(0)
            continue
        if result != "open" or not decision.startswith(GATE_PREFIX):
            continue
        body = decision[len(GATE_PREFIX):].strip()
        question, recommended = body, None
        if RECOMMEND_PREFIX in body:
            question, recommended = body.split(RECOMMEND_PREFIX, 1)
        elif RECOMMEND_PREFIX in why:
            recommended = why.split(RECOMMEND_PREFIX, 1)[1]
        question = question.strip(" ；;，,。")
        recommended = (recommended or MISSING_RECOMMEND).strip(" ；;，,。")
        if question:
            pending.append(GateRow(
                ts=ts, question=question, recommended=recommended))
    return pending


def list_audit_files(repo: str, sha: str, ticket=None, *, run: Runner = gh):
    raw = run(["api", f"repos/{repo}/contents/.audit?ref={sha}"])
    entries = _json(raw, "gh api .audit")
    if not isinstance(entries, list):
        raise SourceError(f"PR head 的 .audit 不是一个目录：{sha}")
    names = sorted(
        entry["name"] for entry in entries
        if entry.get("name", "").endswith(".tsv"))
    if ticket is not None:
        wanted = f"{ticket}.tsv"
        if wanted not in names:
            raise SourceError(f"PR head 没有 .audit/{wanted}")
        return [wanted]
    if not names:
        raise SourceError(f"PR head 的 .audit 下没有 .tsv：{sha}")
    return names


def fetch_file(repo: str, path: str, sha: str, *, run: Runner = gh):
    return run([
        "api", "-H", "Accept: application/vnd.github.raw",
        f"repos/{repo}/contents/{quote(path)}?ref={sha}",
    ])


def build_gate_events(repo: str, pr_number: int, ticket=None,
                      customer=None, requirement=None, *,
                      run: Runner = gh, now=None):
    """读 PR head 的 .audit/<票号>.tsv，每条待答的 gate 行生成一条事件。"""
    raw = run([
        "pr", "view", str(pr_number), "--repo", repo,
        "--json", "headRefOid,headRefName,url,title",
    ])
    pull = _json(raw, f"gh pr view {pr_number}")
    sha = pull["headRefOid"]
    ticket_number = (
        ticket if ticket is not None
        else ticket_from_branch(pull.get("headRefName")))
    names = list_audit_files(repo, sha, ticket_number, run=run)

    issue_customer = issue_requirement = issue_title = None
    if ticket_number is not None:
        issue_customer, issue_requirement, issue_title = _issue_fields(
            repo, ticket_number, run)
    customer = customer or issue_customer
    requirement = requirement or issue_requirement or issue_title or pull.get("title")
    if not customer or not requirement:
        raise SourceError("找不到客户简称或需求名；用 --customer / --requirement 补")

    occurred_at = (now or datetime.now().astimezone()).isoformat(
        timespec="seconds")
    events = []
    for name in names:
        text = fetch_file(repo, f".audit/{name}", sha, run=run)
        for row in parse_gate_rows(text):
            events.append({
                "v": 1,
                "key": f"gate:{repo}:{pr_number}:{name}:{row.ts}",
                "event": "需要你答",
                "occurred_at": occurred_at,
                "link": pull["url"],
                "data": {
                    "customer": customer,
                    "requirement": requirement,
                    "question": row.question,
                    "recommended": row.recommended,
                },
            })
    return events
