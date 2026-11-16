"""调度器替身的组装测试：不读工单，不发送。"""
from __future__ import annotations

import json
import unittest

from notifier.dev.standin import _build_event, _parse_args


class TestStandin(unittest.TestCase):
    def test_builds_push_event(self):
        args = _parse_args([
            "--repo", "Example/repo",
            "--event", "补缺口提案",
            "--customer", "B 店",
            "--requirement", "预约送货",
            "--question-count", "3",
            "--link", "https://example.test/1",
            "--key", "k-standin",
        ])
        event = _build_event(args)
        self.assertEqual(event["v"], 1)
        self.assertEqual(event["key"], "k-standin")
        self.assertEqual(event["event"], "补缺口提案")
        self.assertEqual(event["link"], "https://example.test/1")
        self.assertEqual(
            event["data"],
            {
                "customer": "B 店",
                "requirement": "预约送货",
                "question_count": 3,
            },
        )
        self.assertIn("+08:00", event["occurred_at"])

    def test_builds_daily_sample(self):
        args = _parse_args([
            "--repo", "Example/repo",
            "--event", "每日抽样",
            "--date", "2026-11-15",
            "--item", json.dumps(
                {"customer": "B 店", "requirement": "预约送货", "pr": 123},
                ensure_ascii=False),
        ])
        event = _build_event(args)
        self.assertNotIn("link", event)
        self.assertEqual(event["data"]["date"], "2026-11-15")
        self.assertEqual(event["data"]["items"][0]["pr"], 123)


if __name__ == "__main__":
    unittest.main()
