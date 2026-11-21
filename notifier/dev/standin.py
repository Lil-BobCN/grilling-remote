"""调度器替身：按参数做一次只读查询，组装通知事件，调用真实入口。

只用于测试，不是调度器：不轮询、不判断后续状态、不自己重试。
见 docs/通知.md 的「测试用替身」一节。两种自动来源：

- `--event 每日抽样 --merged-on <日期>`：读前一天合进主干的 PR。
- `--audit-pr <PR号>`：读 PR head 的 `.audit/<票号>.tsv` 里待答的 gate 行。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from . import sources

CUSTOMER_RE = re.compile(r"^- 客户简称：(.*)$", re.MULTILINE)
REQUIREMENT_RE = re.compile(r"^- 需求名：(.*)$", re.MULTILINE)
REPO_ROOT = Path(__file__).resolve().parents[2]


def _parse_args(argv):
    parser = argparse.ArgumentParser(prog="python3 -m notifier.dev.standin")
    parser.add_argument("--repo", required=True, help="工单所在仓库，owner/repo")
    parser.add_argument("--ticket", type=int, help="读一次这张工单")
    parser.add_argument("--repo-dir", help="gate 命令里的客户仓路径")
    parser.add_argument("--event")
    parser.add_argument("--channel", choices=("email", "push"), help="只发一路")
    parser.add_argument("--customer", help="工单上没有客户简称时补")
    parser.add_argument("--requirement", help="工单上没有需求名时补")
    parser.add_argument("--link", help="默认用工单链接")
    parser.add_argument("--key", help="默认按时间造新 key")
    parser.add_argument("--question")
    parser.add_argument("--recommended")
    parser.add_argument("--reason")
    parser.add_argument("--tried")
    parser.add_argument("--address")
    parser.add_argument("--pr", type=int)
    parser.add_argument("--question-count", type=int)
    parser.add_argument("--ticket-count", type=int)
    parser.add_argument("--days-waited", type=int)
    parser.add_argument("--date")
    parser.add_argument(
        "--merged-on", metavar="YYYY-MM-DD",
        help="每日抽样：读这一天当地 00:00 到 24:00 合进主干的 PR",
    )
    parser.add_argument(
        "--audit-pr", type=int,
        help="需要你答：读这张 PR head 的 .audit/<票号>.tsv",
    )
    parser.add_argument(
        "--audit-ticket", type=int,
        help="trail 文件名用的票号；默认从分支 issue-<票号> 取",
    )
    parser.add_argument(
        "--item", action="append", default=[], metavar="JSON",
        help='每日抽样的一项：{"customer":"...","requirement":"...","pr":123}',
    )
    return parser.parse_args(argv)


def _read_issue(repo, number):
    command = [
        "gh", "issue", "view", str(number), "--repo", repo,
        "--json", "number,title,body,url",
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        sys.exit(f"error 读工单失败：{exc}")
    if result.returncode != 0:
        sys.exit(f"error 读工单失败：{result.stderr.strip()}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        sys.exit(f"error 工单返回不是合法 JSON：{exc}")


def _parse_items(values):
    items = []
    for value in values:
        try:
            items.append(json.loads(value))
        except json.JSONDecodeError as exc:
            sys.exit(f"error --item 不是合法 JSON：{exc}")
    return items


def _first_line(regex, body):
    match = regex.search(body or "")
    return match.group(1).strip() if match else None


def _build_event(args):
    if not args.event:
        raise SystemExit("error 需要 --event，或者用 --merged-on / --audit-pr")
    needs_issue = not (args.customer and args.requirement and args.link)
    issue = _read_issue(args.repo, args.ticket) if args.ticket and needs_issue else None
    now = datetime.now().astimezone()
    issue_body = issue.get("body", "") if issue else ""
    customer = args.customer or _first_line(CUSTOMER_RE, issue_body)
    requirement = args.requirement or _first_line(REQUIREMENT_RE, issue_body)
    link = args.link or (issue.get("url") if issue else None)

    if args.event == "每日抽样":
        data = {
            "date": args.date,
            "items": _parse_items(args.item),
        }
    else:
        data = {"customer": customer, "requirement": requirement}

    extra = {
        "question": args.question,
        "recommended": args.recommended,
        "reason": args.reason,
        "tried": args.tried,
        "address": args.address,
        "pr": args.pr,
        "question_count": args.question_count,
        "ticket_count": args.ticket_count,
        "days_waited": args.days_waited,
    }
    data.update({name: value for name, value in extra.items() if value is not None})
    data = {name: value for name, value in data.items() if value is not None}

    waiting = {"补缺口提案": "gap", "拆票提案": "split", "需要你答": "gate"}
    kind = waiting.get(args.event)
    if kind:
        if args.ticket is None:
            raise SystemExit(f"error {args.event} 需要 --ticket，命令里要带票号")
        owner, _, repo_name = args.repo.partition("/")
        data.update({
            "owner": owner,
            "repo": repo_name or args.repo,
            "ticket": args.ticket,
            "kind": kind,
        })
        if args.repo_dir:
            data["repo_dir"] = args.repo_dir

    event = {
        "v": 1,
        "key": args.key or (
            f"standin:{args.repo}:{args.ticket or '-'}:"
            f"{args.event}:{now.isoformat(timespec='seconds')}"),
        "event": args.event,
        "occurred_at": now.isoformat(timespec="seconds"),
        "data": data,
    }
    if link:
        event["link"] = link
    return event


def _daily_event(args):
    items = sources.build_daily_items(
        args.repo, args.merged_on, args.customer)
    if not items:
        print(f"skip {args.merged_on} 没有合进主干的单", file=sys.stderr)
        return None
    return {
        "v": 1,
        "key": f"daily:{args.repo}:{args.merged_on}",
        "event": "每日抽样",
        "occurred_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "data": {"date": args.merged_on, "items": items},
    }


def _send_event(event, channel):
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", suffix=".json", prefix="notifier-event-",
        delete=False,
    ) as handle:
        json.dump(event, handle, ensure_ascii=False)
        event_path = handle.name

    command = [sys.executable, "-m", "notifier", "send", "--event-file", event_path]
    if channel:
        command += ["--channel", channel]
    try:
        return subprocess.run(command, cwd=REPO_ROOT).returncode
    finally:
        Path(event_path).unlink(missing_ok=True)


def main(argv=None):
    args = _parse_args(argv)
    try:
        if args.audit_pr is not None:
            events = sources.build_gate_events(
                args.repo, args.audit_pr, ticket=args.audit_ticket,
                customer=args.customer, requirement=args.requirement)
            if not events:
                print(
                    f"skip PR #{args.audit_pr} 没有待答的 gate 行",
                    file=sys.stderr)
                return 0
        elif args.merged_on:
            if args.event not in (None, "每日抽样"):
                print("error --merged-on 只能配 --event 每日抽样", file=sys.stderr)
                return 2
            event = _daily_event(args)
            if event is None:
                return 0
            events = [event]
        else:
            events = [_build_event(args)]
    except sources.SourceError as exc:
        print(f"error {exc}", file=sys.stderr)
        return 2

    worst = 0
    for event in events:
        print("event " + json.dumps(event, ensure_ascii=False), file=sys.stderr)
        worst = max(worst, _send_event(event, args.channel))
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
