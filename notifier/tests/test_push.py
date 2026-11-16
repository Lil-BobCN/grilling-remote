"""推送消息格式测试：不联网。"""
from __future__ import annotations

import unittest

from notifier.channels.push import _markdown


class TestPushFormat(unittest.TestCase):
    def test_title_and_quoted_body(self):
        text = _markdown("B 店 · 预约送货 · 已进队列", "第一行\n第二行")
        self.assertEqual(
            text,
            "**B 店 · 预约送货 · 已进队列**\n> 第一行\n> 第二行",
        )

    def test_url_is_explicit_link(self):
        text = _markdown("标题", "打开 https://example.test/pull/123 看")
        self.assertIn(
            "[https://example.test/pull/123]"
            "(https://example.test/pull/123)",
            text,
        )

    def test_empty_body(self):
        self.assertEqual(_markdown("标题", ""), "**标题**\n>")


if __name__ == "__main__":
    unittest.main()
