"""orca_bot 通道：用假 orca 执行器测命令、参数、chat 路由和失败。"""
from __future__ import annotations

import json
import tempfile
import textwrap
import unittest
from pathlib import Path

from notifier.channels import ChannelError
from notifier.channels import orca_bot
from notifier.config import OrcaBotConfig

FAKE_ORCA = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parent
    args = sys.argv[1:]
    with (root / "calls.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(args, ensure_ascii=False) + "\\n")

    if args[:2] == ["bot", "chats"]:
        if (root / "fail-chats").exists():
            print(json.dumps({"ok": False, "error": {"message": "列不出 chat"}}))
            sys.exit(1)
        path = root / "chats.json"
        chats = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        print(json.dumps({"ok": True, "result": {"chats": chats}}, ensure_ascii=False))
    elif args[:2] == ["orchestration", "send"]:
        if (root / "fail-send").exists():
            print(json.dumps({"ok": False, "error": {"message": "发送失败"}}))
            sys.exit(1)
        print(json.dumps({"ok": True}))
    else:
        print(json.dumps({"ok": False, "error": {"message": "不认识的命令"}}))
        sys.exit(2)
    """
)


class FakeOrca(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="fake-orca-"))
        script = self.dir / "orca"
        script.write_text(FAKE_ORCA, encoding="utf-8")
        script.chmod(0o755)
        self.command = str(script)
        self.chats([])

    def config(self, **overrides):
        values = {
            "enabled": True,
            "bot": "莹宝（AFK）",
            "timeout": 10.0,
            "command": self.command,
        }
        values.update(overrides)
        return OrcaBotConfig(**values)

    def chats(self, rows):
        (self.dir / "chats.json").write_text(
            json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    def enable_failure(self, kind):
        (self.dir / f"fail-{kind}").write_text("1", encoding="utf-8")

    def calls(self):
        path = self.dir / "calls.jsonl"
        if not path.exists():
            return []
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
        ]

    def sends(self):
        return [call for call in self.calls() if call[:2] == ["orchestration", "send"]]

    def send_args(self, index=0):
        call = self.sends()[index]
        pairs = {}
        options = call[2:]
        cursor = 0
        while cursor < len(options):
            name = options[cursor]
            if name == "--json":
                pairs[name] = True
                cursor += 1
                continue
            pairs[name] = options[cursor + 1]
            cursor += 2
        return pairs


def event(name, data, link=""):
    return {
        "v": 1,
        "key": "k-1",
        "event": name,
        "occurred_at": "2026-11-24T12:00:00+08:00",
        "link": link,
        "data": data,
    }


def proposal_event(name, ticket=42, comment_url="https://github.com/acme/demo/issues/42#issuecomment-9"):
    prefix = "gap" if name == "补缺口提案" else "split"
    return event(
        name,
        {
            "customer": "B 店",
            "requirement": "预约送货",
            "owner": "acme",
            "repo": "demo",
            "ticket": ticket,
            "kind": prefix,
            "comment_url": comment_url,
        },
        f"https://github.com/acme/demo/issues/{ticket}",
    )


class TestProposalRouting(FakeOrca):
    def test_gap_proposal_opens_chat_when_title_missing(self):
        self.chats([{"id": "c-other", "title": "补缺口 acme/demo#41", "closed": False}])
        event_data = proposal_event("补缺口提案")
        orca_bot.send(
            self.config(), "B 店 · 预约送货 · 等你补缺口（3 题）",
            "闸门题和推荐答案列好了。https://github.com/acme/demo/issues/42",
            None, event_data,
        )

        chats_call = self.calls()[0]
        self.assertEqual(chats_call, ["bot", "chats", "--bot", "莹宝（AFK）", "--json"])
        args = self.send_args()
        self.assertEqual(args["--to"], "bot:莹宝（AFK）")
        self.assertEqual(args["--type"], "handoff")
        self.assertEqual(args["--subject"], "补缺口 acme/demo#42")
        self.assertEqual(args["--chat"], "new")
        self.assertIn("https://github.com/acme/demo/issues/42", args["--body"])
        self.assertIn("#issuecomment-9", args["--body"])

    def test_split_proposal_uses_existing_chat(self):
        self.chats([{"id": "c-split", "title": "拆票 acme/demo#42", "closed": False}])
        orca_bot.send(
            self.config(), "标题", "正文",
            None, proposal_event("拆票提案"),
        )

        args = self.send_args()
        self.assertEqual(args["--subject"], "拆票 acme/demo#42")
        self.assertEqual(args["--chat"], "c-split")

    def test_each_parent_keeps_its_own_chat(self):
        self.chats([
            {"id": "c42", "title": "补缺口 acme/demo#42", "closed": False},
            {"id": "c43", "title": "补缺口 acme/other#43", "closed": False},
        ])
        orca_bot.send(self.config(), "标题", "正文 42", None, proposal_event("补缺口提案", 42))
        other = proposal_event("补缺口提案", 43)
        other["data"]["repo"] = "other"
        other["link"] = "https://github.com/acme/other/issues/43"
        orca_bot.send(self.config(), "标题", "正文 43", None, other)

        first, second = self.send_args(0), self.send_args(1)
        self.assertEqual(first["--chat"], "c42")
        self.assertEqual(first["--subject"], "补缺口 acme/demo#42")
        self.assertEqual(second["--chat"], "c43")
        self.assertEqual(second["--subject"], "补缺口 acme/other#43")

    def test_closed_chat_counts_as_missing(self):
        self.chats([{"id": "c-old", "title": "拆票 acme/demo#42", "closed": True}])
        orca_bot.send(self.config(), "标题", "正文", None, proposal_event("拆票提案"))

        self.assertEqual(self.send_args()["--chat"], "new")


class TestNonProposalRouting(FakeOrca):
    def test_prefers_split_chat(self):
        self.chats([
            {"id": "c-gap", "title": "补缺口 acme/demo#42", "closed": False},
            {"id": "c-split", "title": "拆票 acme/demo#42", "closed": False},
        ])
        orca_bot.send(
            self.config(), "标题", "正文",
            None,
            event("需要你答", {
                "customer": "B 店", "requirement": "预约送货",
                "question": "选哪个", "recommended": "方案 A",
                "owner": "acme", "repo": "demo", "ticket": 42, "kind": "gate",
            }, "https://github.com/acme/demo/pull/7"),
        )

        args = self.send_args()
        self.assertEqual(args["--chat"], "c-split")
        self.assertEqual(args["--subject"], "拆票 acme/demo#42")
        self.assertIn("https://github.com/acme/demo/issues/42", args["--body"])

    def test_falls_back_to_gap_chat(self):
        self.chats([{"id": "c-gap", "title": "补缺口 acme/demo#42", "closed": False}])
        orca_bot.send(
            self.config(), "标题", "正文",
            None,
            event("needs-info", {"customer": "B 店", "requirement": "预约送货"},
                  "https://github.com/acme/demo/issues/42"),
        )

        args = self.send_args()
        self.assertEqual(args["--chat"], "c-gap")
        self.assertEqual(args["--subject"], "补缺口 acme/demo#42")

    def test_home_chat_when_parent_has_no_chat(self):
        self.chats([])
        orca_bot.send(
            self.config(), "B 店 · 预约送货 · 已部署", "部署好了。",
            None,
            event("部署完成", {"customer": "B 店", "requirement": "预约送货",
                            "address": "https://b.example.test"}),
        )

        args = self.send_args()
        self.assertNotIn("--chat", args)
        self.assertEqual(args["--subject"], "B 店 · 预约送货 · 已部署")

    def test_parent_identity_comes_from_issue_link(self):
        self.chats([{"id": "c-split", "title": "拆票 acme/demo#42", "closed": False}])
        orca_bot.send(
            self.config(), "标题", "正文",
            None,
            event("出事", {"customer": "B 店", "requirement": "预约送货",
                         "reason": "同类两次", "tried": "重跑一次"},
                  "https://github.com/acme/demo/issues/42"),
        )

        self.assertEqual(self.send_args()["--chat"], "c-split")

    def test_unparseable_link_goes_home(self):
        self.chats([])
        orca_bot.send(
            self.config(), "标题", "正文",
            None,
            event("出事", {"customer": "B 店", "requirement": "预约送货",
                         "reason": "同类两次", "tried": "重跑一次"},
                  "https://github.com/acme/demo/pull/7"),
        )

        self.assertNotIn("--chat", self.send_args())


class TestFailures(FakeOrca):
    def test_chat_listing_failure_raises(self):
        self.enable_failure("chats")
        with self.assertRaises(ChannelError) as raised:
            orca_bot.send(self.config(), "标题", "正文", None, proposal_event("补缺口提案"))
        self.assertIn("列不出 chat", str(raised.exception))

    def test_send_failure_raises(self):
        self.enable_failure("send")
        with self.assertRaises(ChannelError) as raised:
            orca_bot.send(self.config(), "标题", "正文", None, proposal_event("补缺口提案"))
        self.assertIn("发送失败", str(raised.exception))

    def test_missing_command_raises(self):
        with self.assertRaises(ChannelError):
            orca_bot.send(
                self.config(command=str(self.dir / "no-such-orca")),
                "标题", "正文", None, proposal_event("补缺口提案"),
            )


if __name__ == "__main__":
    unittest.main()
