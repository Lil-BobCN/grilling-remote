"""数据来源测试：不联网，注入假的 gh。"""
from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone

from notifier.dev import sources

TZ = timezone(timedelta(hours=8))
REPO = "Example/repo"

GATE_TSV = (
    "ts\tphase\tdecision\twhy\tevidence\tresult\n"
    "2026-11-16T10:00:00+08:00\tgate\t问：选哪个方案？推荐：方案 A"
    "\t为什么问\thttps://example.test/pull/1\topen\n"
    "2026-11-16T10:05:00+08:00\tgate\t答：方案 A\t运营者确认"
    "\thttps://example.test/pull/1\tanswered\n"
    "2026-11-16T09:00:00+08:00\tverify\t跑测试\t回归\tcommit abc\tgreen\n"
    "2026-11-16T11:00:00+08:00\tgate\t问：要不要加一条？"
    "\t理由写在 why，推荐：不加\thttps://example.test/pull/1\topen\n"
    "2026-11-16T12:00:00+08:00\tgate\t问：没写推荐怎么显示？\t只有理由"
    "\thttps://example.test/pull/1\topen\n"
    "2026-11-16T13:00:00+08:00\tgate\t问：先搁置的问题\t理由"
    "\thttps://example.test/pull/1\tparked\n"
)

PULLS = {
    "2026-11-14": [
        {"number": 1, "title": "早一秒", "url": "https://example.test/pull/1",
         "mergedAt": "2026-11-14T15:59:00Z", "headRefName": "x/issue-1"},
        {"number": 2, "title": "零点", "url": "https://example.test/pull/2",
         "mergedAt": "2026-11-14T16:00:00Z", "headRefName": "x/issue-2"},
    ],
    "2026-11-15": [
        {"number": 3, "title": "次日零点",
         "url": "https://example.test/pull/3",
         "mergedAt": "2026-11-15T16:00:00Z", "headRefName": "x/issue-3"},
        {"number": 4, "title": "下午",
         "url": "https://example.test/pull/4",
         "mergedAt": "2026-11-15T06:41:03Z", "headRefName": "x/other"},
    ],
}


def daily_runner(args):
    if args[:2] == ["pr", "list"]:
        day = args[args.index("--search") + 1].split(":", 1)[1]
        return json.dumps(PULLS[day])
    if args[:2] == ["issue", "view"]:
        number = int(args[2])
        body = "" if number != 2 else "- 客户简称：B 店\n- 需求名：预约送货\n"
        return json.dumps({"title": f"票 {number}", "body": body})
    raise AssertionError(f"unexpected gh call: {args}")


def gate_runner(args):
    if args[:2] == ["pr", "view"]:
        return json.dumps({
            "headRefOid": "sha1",
            "headRefName": "Lil-BobCN/gate",
            "url": "https://example.test/pull/12",
            "title": "每日汇总与 gate 链接",
        })
    if args[:1] == ["api"]:
        if args[1] == "-H":
            return GATE_TSV
        if args[1].endswith("/contents/.audit?ref=sha1"):
            return json.dumps([{"name": "355.tsv"}])
    if args[:2] == ["issue", "view"]:
        return json.dumps({"title": "每日汇总与 gate 链接", "body": ""})
    raise AssertionError(f"unexpected gh call: {args}")


class TestDayWindow(unittest.TestCase):
    def test_local_day(self):
        start, end = sources.local_day_window("2026-11-15", TZ)
        self.assertEqual(start.isoformat(), "2026-11-15T00:00:00+08:00")
        self.assertEqual(end.isoformat(), "2026-11-16T00:00:00+08:00")

    def test_bad_day(self):
        with self.assertRaises(sources.SourceError):
            sources.local_day_window("2026-13-01", TZ)


class TestParseGateRows(unittest.TestCase):
    def test_only_open_gate_rows(self):
        rows = sources.parse_gate_rows(GATE_TSV)
        self.assertEqual([row.question for row in rows], [
            "要不要加一条？",
            "没写推荐怎么显示？",
        ])
        self.assertEqual([
            row.recommended for row in rows
        ], ["不加", "未写推荐"])

    def test_answer_closes_earliest_open_question(self):
        rows = sources.parse_gate_rows(
            "ts\tphase\tdecision\twhy\tevidence\tresult\n"
            "2026-11-16T10:00:00+08:00\tgate\t问：第一问\t理由\te\topen\n"
            "2026-11-16T10:01:00+08:00\tgate\t问：第二问\t理由\te\topen\n"
            "2026-11-16T10:02:00+08:00\tgate\t答：第一答\t理由\te\tanswered\n")
        self.assertEqual([row.question for row in rows], ["第二问"])

    def test_parked_answer_also_stops_reminder(self):
        rows = sources.parse_gate_rows(
            "ts\tphase\tdecision\twhy\tevidence\tresult\n"
            "2026-11-16T10:00:00+08:00\tgate\t问：先搁置\t理由\te\topen\n"
            "2026-11-16T10:02:00+08:00\tgate\t答：先搁置\t理由\te\tparked\n")
        self.assertEqual(rows, [])

    def test_ticket_from_branch(self):
        self.assertEqual(
            sources.ticket_from_branch("Lil-BobCN/issue-355"), 355)
        self.assertIsNone(sources.ticket_from_branch("Lil-BobCN/gate"))


class TestDailyItems(unittest.TestCase):
    def test_filters_local_day_and_fills_fields(self):
        items = sources.build_daily_items(
            REPO, "2026-11-15", "工厂", run=daily_runner, tz=TZ)
        self.assertEqual([item["pr"] for item in items], [2, 4])
        self.assertEqual(items[0], {
            "customer": "B 店",
            "requirement": "预约送货",
            "pr": 2,
            "url": "https://example.test/pull/2",
        })
        self.assertEqual(items[1], {
            "customer": "工厂",
            "requirement": "下午",
            "pr": 4,
            "url": "https://example.test/pull/4",
        })

    def test_no_customer_field_needs_fallback(self):
        with self.assertRaises(sources.SourceError):
            sources.build_daily_items(
                REPO, "2026-11-15", None, run=daily_runner, tz=TZ)


class TestGateEvents(unittest.TestCase):
    def test_builds_one_event_per_open_row(self):
        events = sources.build_gate_events(
            REPO, 12, ticket=355, customer="工厂", run=gate_runner,
            now=datetime(2026, 11, 16, 9, 0, tzinfo=TZ))
        self.assertEqual(len(events), 2)
        first = events[0]
        self.assertEqual(first["event"], "需要你答")
        self.assertEqual(first["link"], "https://example.test/pull/12")
        self.assertEqual(first["occurred_at"], "2026-11-16T09:00:00+08:00")
        self.assertEqual(first["data"], {
            "customer": "工厂",
            "requirement": "每日汇总与 gate 链接",
            "question": "要不要加一条？",
            "recommended": "不加",
            "owner": "Example",
            "repo": "repo",
            "ticket": 355,
            "kind": "gate",
        })
        self.assertEqual(len({event["key"] for event in events}), 2)

    def test_missing_audit_file(self):
        def runner(args):
            if args[:2] == ["pr", "view"]:
                return json.dumps({
                    "headRefOid": "sha1",
                    "headRefName": "Lil-BobCN/issue-355",
                    "url": "https://example.test/pull/12",
                    "title": "t",
                })
            if args[:1] == ["api"]:
                return json.dumps([{"name": "354.tsv"}])
            raise AssertionError(f"unexpected gh call: {args}")

        with self.assertRaises(sources.SourceError):
            sources.build_gate_events(REPO, 12, run=runner)


if __name__ == "__main__":
    unittest.main()
