#!/usr/bin/env python3
"""按《决策记录》里的条目核对中台。只读，不改任何文件。

每条 `决定：D-xxxx` 核对四件事：决定在中台存在；状态和文件一致；
被取代的指向新决定；来源票号对得上。文件写了 `（GitHub #N）` 时，
再按 sync.jsonl 的映射核对本地票号对应的 GitHub 号。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_PORT = 8788
SERVICE_FILE = Path.home() / ".grilling" / "中台" / "service.json"
SYNC_FILE = Path.home() / ".grilling" / "中台" / "sync.jsonl"
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RECORD_FILE = REPO_ROOT / "docs" / "adr" / "决策记录.md"

DECISION_LINE = re.compile(r"^决定：(D-[A-Za-z0-9-]+)\s*$")
SUPERSEDED_LINE = re.compile(r"^被取代[，,]\s*见\s*(D-[A-Za-z0-9-]+)$")
SOURCE_FIRST_WORD = re.compile(r"^[^\s（(）)]+")
GITHUB_ANNOTATION = re.compile(r"[（(]\s*GitHub\s*#(\d+)\s*[）)]")


class UsageError(Exception):
    """用法错、文件读不到、中台连不上，退出码 2。"""


class BoardUnreachable(Exception):
    """中台请求失败。"""


def service_port() -> int:
    try:
        data = json.loads(SERVICE_FILE.read_text(encoding="utf-8"))
        port = int(data["port"])
        if 0 < port < 65536:
            return port
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        pass
    return DEFAULT_PORT


def parse_records(text: str) -> list[dict]:
    """按 `决定：D-xxxx` 行切条，收集同一节里的来源票、状态、日期。"""
    records: list[dict] = []
    current: dict | None = None
    for lineno, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("### "):
            current = None
            continue
        match = DECISION_LINE.match(stripped)
        if match:
            current = {
                "id": match.group(1),
                "line": lineno,
                "source_raw": None,
                "status_raw": None,
            }
            records.append(current)
            continue
        if current is None:
            continue
        for prefix, key in (
            ("来源票：", "source_raw"),
            ("状态：", "status_raw"),
        ):
            if stripped.startswith(prefix):
                current[key] = stripped[len(prefix):].strip()
                break
    return records


def fetch_decision(base: str, decision_id: str) -> dict | None:
    url = f"{base}/decision/{decision_id}"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            body = response.read()
    except urllib.error.HTTPError:
        # 非 2xx：这条决定不存在。
        return None
    except (urllib.error.URLError, OSError) as exc:
        raise BoardUnreachable(f"{base}（{exc}）") from exc
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BoardUnreachable(f"{base} 返回的不是 JSON：{exc}") from exc
    if not payload.get("ok"):
        return None
    decision = (payload.get("data") or {}).get("decision")
    if not isinstance(decision, dict):
        raise BoardUnreachable(f"{base} 返回的数据里没有 decision")
    return decision


def load_mappings() -> dict[str, str]:
    """读 sync.jsonl 的 issue 映射：本地票号 -> GitHub 号，后写覆盖先写。"""
    try:
        lines = SYNC_FILE.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise UsageError(f"读不到映射文件 {SYNC_FILE}：{exc}") from exc
    mappings: dict[str, str] = {}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if record.get("type") != "mapping" or record.get("kind") != "issue":
            continue
        local = record.get("local")
        github = record.get("github")
        if local is None or github is None:
            continue
        mappings[str(local)] = str(github)
    return mappings


def normalize_github(value: str) -> str:
    value = value.strip()
    return str(int(value)) if value.isdigit() else value


def server_status_text(decision: dict) -> str:
    status = decision.get("status")
    if status == "active":
        return "现行"
    if status == "superseded":
        target = decision.get("superseded_by")
        return f"被取代，见 {target}" if target else "被取代，但中台没写指向"
    if status == "void":
        return "作废"
    return f"未知状态 {status}"


def check_entry(
    record: dict,
    decision: dict | None,
    mappings: dict[str, str] | None,
) -> str | None:
    """返回失败说明；全部通过返回 None。"""
    decision_id = record["id"]

    if decision is None:
        return "中台没有这条决定"

    failures: list[str] = []

    # 状态一致。
    file_status_text = record["status_raw"] if record["status_raw"] else "没写状态"
    server_status = server_status_text(decision)
    matched = False
    if record["status_raw"] == "现行":
        matched = decision.get("status") == "active"
    elif record["status_raw"] == "作废":
        matched = decision.get("status") == "void"
    else:
        superseded = SUPERSEDED_LINE.match(record["status_raw"] or "")
        if superseded:
            matched = (
                decision.get("status") == "superseded"
                and decision.get("superseded_by") == superseded.group(1)
            )
    if not matched:
        failures.append(f"状态不符：文件写 {file_status_text}，中台写 {server_status}")

    # 来源票一致。
    file_source = record["source_raw"]
    local_ticket = None
    if file_source:
        first_word = SOURCE_FIRST_WORD.match(file_source)
        if first_word:
            local_ticket = first_word.group(0)
    server_source = decision.get("source_ticket")
    if local_ticket is None:
        failures.append(f"来源票不符：文件没写来源票，中台写 {server_source or '（空）'}")
    elif server_source != local_ticket:
        failures.append(
            f"来源票不符：文件写 {local_ticket}，中台写 {server_source or '（空）'}"
        )

    # 本地票的 GitHub 号。
    if local_ticket and file_source:
        annotation = GITHUB_ANNOTATION.search(file_source)
        if annotation:
            if mappings is None:
                raise UsageError(f"读不到映射文件 {SYNC_FILE}")
            mapped = mappings.get(local_ticket)
            if mapped is None:
                failures.append(
                    f"映射找不到：sync.jsonl 里没有 {local_ticket} 的 issue 映射"
                )
            elif normalize_github(mapped) != normalize_github(annotation.group(1)):
                failures.append(
                    f"GitHub 号不符：文件写 #{annotation.group(1)}，映射是 #{mapped}"
                )

    return "；".join(failures) if failures else None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "按《决策记录》里的每条 `决定：D-xxxx` 核对中台："
            "决定存在、状态一致、被取代的指向新决定、来源票号对得上。"
            "只读，只报，不改正文。"
        ),
        epilog=(
            "依赖：中台服务要在跑（默认 http://127.0.0.1:8788，端口读 "
            "~/.grilling/中台/service.json）；GitHub 号映射读 "
            "~/.grilling/中台/sync.jsonl。\n"
            "退出码：0 全部通过；1 有失败；2 用法错、文件读不到、中台连不上。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--file",
        default=str(DEFAULT_RECORD_FILE),
        help="决策记录文件路径，默认仓库里的 docs/adr/决策记录.md",
    )
    parser.add_argument(
        "--base",
        default=None,
        help="中台服务地址，默认按 service.json 的端口拼 http://127.0.0.1:<port>",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    record_file = Path(args.file)
    try:
        text = record_file.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"错误：读不到 {record_file}：{exc}", file=sys.stderr)
        return 2

    records = parse_records(text)
    if not records:
        print(f"错误：{record_file} 里没有 决定：D-xxxx 行", file=sys.stderr)
        return 2

    base = args.base.rstrip("/") if args.base else f"http://127.0.0.1:{service_port()}"

    # 按文件顺序去重；同一编号出现多次只算一条失败。
    by_id: dict[str, list[dict]] = {}
    order: list[str] = []
    for record in records:
        if record["id"] not in by_id:
            by_id[record["id"]] = []
            order.append(record["id"])
        by_id[record["id"]].append(record)

    mappings: dict[str, str] | None = None
    passed = 0
    failed = 0
    try:
        for decision_id in order:
            occurrences = by_id[decision_id]
            if len(occurrences) > 1:
                lines = "、".join(str(item["line"]) for item in occurrences)
                print(f"{decision_id}  文件里出现 {len(occurrences)} 次（第 {lines} 行）")
                failed += 1
                continue

            record = occurrences[0]
            file_source = record["source_raw"] or ""
            if mappings is None and GITHUB_ANNOTATION.search(file_source):
                mappings = load_mappings()
            decision = fetch_decision(base, decision_id)
            failure = check_entry(record, decision, mappings)
            if failure:
                print(f"{decision_id}  {failure}")
                failed += 1
            else:
                print(f"{decision_id}  OK")
                passed += 1
    except BoardUnreachable as exc:
        print(f"错误：中台连不上：{exc}", file=sys.stderr)
        return 2
    except UsageError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2

    print(f"共 {len(order)} 条，通过 {passed} 条，失败 {failed} 条")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
