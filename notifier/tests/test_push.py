"""推送格式与拆条测试：不联网。"""
from __future__ import annotations

import unittest

from notifier.channels.push import CONTENT_LIMIT, _contents, _linkify, _markdown


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

    def test_markdown_link_is_kept(self):
        self.assertEqual(
            _linkify("见 [PR #1](https://example.test/pull/1)"),
            "见 [PR #1](https://example.test/pull/1)",
        )

    def test_url_before_chinese_punctuation(self):
        self.assertEqual(
            _linkify("https://example.test/pull/1；下一项"),
            "[https://example.test/pull/1](https://example.test/pull/1)；下一项",
        )

    def test_empty_body(self):
        self.assertEqual(_markdown("标题", ""), "**标题**\n>")


class TestPushSplit(unittest.TestCase):
    def test_short_body_is_one_message(self):
        contents = _contents("昨天合了 2 单", "B 店 · 预约送货（PR #123）")
        self.assertEqual(len(contents), 1)

    def test_long_body_splits_at_item_boundary(self):
        items = [
            f"店{i} · 需求{i}（[PR #{i}](https://example.test/pull/{i})）"
            for i in range(1, 121)
        ]
        body = "；".join(items)
        contents = _contents("昨天合了 120 单", body)
        self.assertGreater(len(contents), 1)
        for content in contents:
            self.assertLessEqual(
                len(content.encode("utf-8")), CONTENT_LIMIT)
        self.assertIn("**昨天合了 120 单**", contents[0])
        self.assertRegex("".join(contents), r"（续\d+/\d+）")
        self.assertEqual("".join(contents).count("PR #"), 120)

    def test_single_long_line_hard_splits(self):
        body = "长" * 5000
        contents = _contents("标题", body)
        self.assertGreater(len(contents), 1)
        for content in contents:
            self.assertLessEqual(
                len(content.encode("utf-8")), CONTENT_LIMIT)
        self.assertEqual("".join(contents).count("长"), 5000)


if __name__ == "__main__":
    unittest.main()
