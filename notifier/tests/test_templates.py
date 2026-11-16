"""模板单元测试：固定措辞按 docs/通知与事件表.md 第二节。"""
from __future__ import annotations

import copy
import unittest

from notifier.templates import EMAIL, EVENTS, PUSH, EventError, render_event


def samples():
    return {
        "新单进队列": (
            {"customer": "B 店", "requirement": "预约送货"},
            "https://example.test/1",
        ),
        "补缺口提案": (
            {"customer": "B 店", "requirement": "预约送货", "question_count": 3},
            "https://example.test/1",
        ),
        "该跑 to-spec": (
            {"customer": "B 店", "requirement": "预约送货"},
            "https://example.test/1",
        ),
        "拆票提案": (
            {"customer": "B 店", "requirement": "预约送货", "ticket_count": 5},
            "https://example.test/1",
        ),
        "需要你答": (
            {
                "customer": "B 店",
                "requirement": "预约送货",
                "question": "闸门第三题选哪个方案",
                "recommended": "方案 A",
            },
            "https://example.test/pull/123",
        ),
        "出事": (
            {
                "customer": "B 店",
                "requirement": "预约送货",
                "reason": "同类两次",
                "tried": "重跑一次仍未过",
            },
            "https://example.test/1",
        ),
        "自己合并": (
            {"customer": "B 店", "requirement": "预约送货", "pr": 123},
            "https://example.test/pull/123",
        ),
        "部署完成": (
            {
                "customer": "B 店",
                "requirement": "预约送货",
                "address": "https://b-shop.example.test",
            },
            "https://example.test/1",
        ),
        "needs-info": (
            {"customer": "B 店", "requirement": "预约送货"},
            "https://example.test/1",
        ),
        "点火超时": (
            {"customer": "B 店", "requirement": "预约送货"},
            "https://example.test/1",
        ),
        "每日抽样": (
            {
                "date": "2026-11-15",
                "items": [
                    {"customer": "B 店", "requirement": "预约送货", "pr": 123},
                    {"customer": "A 店", "requirement": "库存提醒", "pr": 124},
                ],
            },
            None,
        ),
    }


class TestTemplates(unittest.TestCase):
    def test_event_count_and_channels(self):
        self.assertEqual(len(EVENTS), 11)
        self.assertEqual(EVENTS["出事"].channels, (PUSH, EMAIL))
        self.assertEqual(EVENTS["点火超时"].channels, (EMAIL,))
        self.assertEqual(EVENTS["每日抽样"].channels, (PUSH,))

    def test_all_events_render(self):
        for event, (data, link) in samples().items():
            with self.subTest(event=event):
                title, body = render_event(event, data, link)
                self.assertTrue(title)
                self.assertTrue(body or event == "每日抽样")

    def test_need_answer_exact(self):
        data, link = samples()["需要你答"]
        title, body = render_event("需要你答", data, link)
        self.assertEqual(title, "B 店 · 预约送货 · 等你答：闸门第三题选哪个方案")
        self.assertEqual(
            body,
            "闸门第三题选哪个方案。推荐：方案 A。打开 Orca 答。"
            "https://example.test/pull/123",
        )

    def test_incident_exact(self):
        data, link = samples()["出事"]
        title, body = render_event("出事", data, link)
        self.assertEqual(title, "B 店 · 预约送货 · 卡住：同类两次")
        self.assertEqual(
            body,
            "停在这条线上了。试过：重跑一次仍未过。来处理：继续、换法或停。"
            "https://example.test/1",
        )

    def test_daily_sample_exact(self):
        data, link = samples()["每日抽样"]
        title, body = render_event("每日抽样", data, link)
        self.assertEqual(title, "昨天合了 2 单")
        self.assertEqual(
            body,
            "B 店 · 预约送货（PR #123）；A 店 · 库存提醒（PR #124）",
        )

    def test_days_waited_appended(self):
        data, link = samples()["补缺口提案"]
        data["days_waited"] = 2
        title, body = render_event("补缺口提案", data, link)
        self.assertEqual(title, "B 店 · 预约送货 · 等你补缺口（3 题）")
        self.assertTrue(body.endswith("\n已等 2 天。"))

    def test_each_event_requires_its_fields(self):
        for event, spec in EVENTS.items():
            with self.subTest(event=event):
                data, link = copy.deepcopy(samples()[event])
                del data[spec.required[0]]
                with self.assertRaises(EventError) as raised:
                    render_event(event, data, link)
                self.assertIn(spec.required[0], str(raised.exception))

    def test_link_required_except_daily(self):
        for event, spec in EVENTS.items():
            if not spec.needs_link:
                continue
            with self.subTest(event=event):
                data, _ = copy.deepcopy(samples()[event])
                with self.assertRaises(EventError) as raised:
                    render_event(event, data, None)
                self.assertIn("link", str(raised.exception))

    def test_bad_items(self):
        data = {"date": "2026-11-15", "items": "not-a-list"}
        with self.assertRaises(EventError):
            render_event("每日抽样", data, None)
        data = {
            "date": "2026-11-15",
            "items": [{"customer": "B 店", "requirement": "预约送货"}],
        }
        with self.assertRaises(EventError) as raised:
            render_event("每日抽样", data, None)
        self.assertIn("pr", str(raised.exception))

    def test_unknown_event(self):
        with self.assertRaises(EventError) as raised:
            render_event("不存在的通知", {"customer": "B 店"}, "https://e/1")
        self.assertIn("未知事件", str(raised.exception))

    def test_empty_string_rejected(self):
        data, link = samples()["新单进队列"]
        data["customer"] = "  "
        with self.assertRaises(EventError):
            render_event("新单进队列", data, link)


if __name__ == "__main__":
    unittest.main()
