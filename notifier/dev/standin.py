"""调度器替身：读一次工单，组装一条通知事件，调用真实入口。

只用于测试，不是调度器：不轮询、不判断后续状态、不自己重试。
见 docs/通知模块边界.md 第七节。
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

CUSTOMER_RE = re.compile(r"^- 客户简称：(.*)$", re.MULTILINE)
REQUIREMENT_RE = re.compile(r"^- 需求名：(.*)$", re.MULTILINE)
REPO_ROOT = Path(__file__).resolve().parents[2]


def _parse_args(argv):
    parser = argparse.ArgumentParser(prog="python3 -m notifier.dev.standin")
    parser.add_argument("--repo", required=True, help="工单所在仓库，owner/repo")
    parser.add_argument("--ticket", type=int, help="读一次这张工单")
    parser.add_argument("--event", required=True)
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
    issue = _read_issue(args.repo, args.ticket) if args.ticket else None
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


def main(argv=None):
    args = _parse_args(argv)
    event = _build_event(args)
    print("event " + json.dumps(event, ensure_ascii=False), file=sys.stderr)

    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", suffix=".json", prefix="notifier-event-",
        delete=False,
    ) as handle:
        json.dump(event, handle, ensure_ascii=False)
        event_path = handle.name

    command = [sys.executable, "-m", "notifier", "send", "--event-file", event_path]
    if args.channel:
        command += ["--channel", args.channel]
    try:
        return subprocess.run(command, cwd=REPO_ROOT).returncode
    finally:
        Path(event_path).unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
