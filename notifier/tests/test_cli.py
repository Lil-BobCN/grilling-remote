"""命令行单元测试：不联网，不碰真钥匙串，不写真运行目录。"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from notifier import __main__ as cli
from notifier.channels import ChannelError
from notifier.config import ConfigError

BASE_CONFIG = {
    "channels": {
        "email": {
            "enabled": True,
            "to": "ops@example.com",
            "from": "notify@example.com",
            "host": "smtp.example.com",
            "port": 465,
            "timeout_seconds": 30,
        },
        "push": {"enabled": True, "timeout_seconds": 15},
    },
    "log": {"level": "info"},
    "retry": {"attempts": 3, "interval_seconds": 0},
}


def base_event():
    return {
        "v": 1,
        "key": "k-1",
        "event": "新单进队列",
        "occurred_at": "2026-11-16T12:00:00+08:00",
        "link": "https://example.test/1",
        "data": {"customer": "B 店", "requirement": "预约送货"},
    }


class Base(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="notifier-test-"))
        self.sent = []
        self.write_config()

    def write_config(self, config=None):
        (self.home / "config.json").write_text(
            json.dumps(config or BASE_CONFIG, ensure_ascii=False),
            encoding="utf-8",
        )

    def event_file(self, event=None):
        path = self.home / "event.json"
        path.write_text(
            json.dumps(event or base_event(), ensure_ascii=False),
            encoding="utf-8",
        )
        return path

    def fake_sender(self, name, fail=False):
        def send(config, title, body, secret, event=None):
            self.sent.append((name, title, body, secret))
            if fail:
                raise ChannelError("boom")
        return send

    def run_cli(self, *extra, event=None, event_path=None, senders=None,
                secret_reader=None, home=None):
        senders = senders or {
            "email": self.fake_sender("email"),
            "push": self.fake_sender("push"),
        }
        secret_reader = secret_reader or (lambda service: "secret")
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.run(
                ["send", "--event-file", str(event_path or self.event_file(event)),
                 *extra],
                home=str(home or self.home),
                secret_reader=secret_reader,
                senders=senders,
            )
        return code, out.getvalue(), err.getvalue()

    def log_records(self):
        path = self.home / "notify.log"
        if not path.exists():
            return []
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
        ]


class TestRouting(Base):
    def test_push_only_event(self):
        code, out, _ = self.run_cli()
        self.assertEqual(code, 0)
        self.assertEqual([name for name, *_ in self.sent], ["push"])
        result = json.loads(out)
        self.assertEqual(result["key"], "k-1")
        self.assertFalse(result["skipped"])
        self.assertEqual(
            [entry["channel"] for entry in result["results"]], ["push"])
        self.assertEqual(
            set(result["results"][0]), {"channel", "ok", "ms"})

    def test_incident_sends_both_channels(self):
        event = base_event()
        event["event"] = "出事"
        event["data"] = {
            "customer": "B 店",
            "requirement": "预约送货",
            "reason": "同类两次",
            "tried": "重跑一次仍未过",
        }
        code, out, _ = self.run_cli(event=event)
        self.assertEqual(code, 0)
        self.assertEqual([name for name, *_ in self.sent], ["push", "email"])
        result = json.loads(out)
        self.assertEqual(
            [entry["channel"] for entry in result["results"]], ["push", "email"])

    def test_waiting_events_send_push_before_email(self):
        events = {
            "补缺口提案": {
                "customer": "B 店",
                "requirement": "预约送货",
                "question_count": 3,
                "owner": "Lil-BobCN",
                "repo": "acme-shop",
                "ticket": 42,
                "kind": "gap",
            },
            "该跑 to-spec": {
                "customer": "B 店",
                "requirement": "预约送货",
            },
            "拆票提案": {
                "customer": "B 店",
                "requirement": "预约送货",
                "ticket_count": 5,
                "owner": "Lil-BobCN",
                "repo": "acme-shop",
                "ticket": 42,
                "kind": "split",
            },
            "需要你答": {
                "customer": "B 店",
                "requirement": "预约送货",
                "question": "闸门第三题选哪个方案",
                "recommended": "方案 A",
                "owner": "Lil-BobCN",
                "repo": "acme-shop",
                "ticket": 42,
                "kind": "gate",
                "repo_dir": "/Users/Admin/.afkfactory/repos/acme-shop",
            },
        }
        for name, data in events.items():
            with self.subTest(event=name):
                self.sent.clear()
                event = base_event()
                event["key"] = f"k-{name}"
                event["event"] = name
                event["data"] = data
                code, out, _ = self.run_cli(event=event)
                self.assertEqual(code, 0)
                self.assertEqual(
                    [sent for sent, *_ in self.sent], ["push", "email"])
                result = json.loads(out)
                self.assertEqual(
                    [entry["channel"] for entry in result["results"]],
                    ["push", "email"])

    def test_channel_override(self):
        code, _, _ = self.run_cli("--channel", "email")
        self.assertEqual(code, 0)
        self.assertEqual([name for name, *_ in self.sent], ["email"])

    def test_channel_failure_exits_1(self):
        senders = {
            "email": self.fake_sender("email"),
            "push": self.fake_sender("push", fail=True),
        }
        code, out, _ = self.run_cli(senders=senders)
        self.assertEqual(code, 1)
        result = json.loads(out)
        self.assertFalse(result["results"][0]["ok"])
        records = self.log_records()
        self.assertEqual(records[0]["channel"], "push")
        self.assertFalse(records[0]["ok"])
        self.assertIn("boom", records[0]["error"])

    def test_disabled_channel_is_config_error(self):
        config = copy.deepcopy(BASE_CONFIG)
        config["channels"]["push"]["enabled"] = False
        self.write_config(config)
        code, _, err = self.run_cli()
        self.assertEqual(code, 2)
        self.assertEqual(self.sent, [])
        self.assertIn("未启用", err)

    def test_missing_secret_is_config_error_before_send(self):
        def reader(service):
            raise ConfigError(f"missing {service}")

        code, _, err = self.run_cli(secret_reader=reader)
        self.assertEqual(code, 2)
        self.assertEqual(self.sent, [])
        self.assertIn("missing", err)


class TestLogging(Base):
    def test_log_has_event_channel_time_result(self):
        self.run_cli()
        records = self.log_records()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["event"], "新单进队列")
        self.assertEqual(records[0]["key"], "k-1")
        self.assertEqual(records[0]["channel"], "push")
        self.assertTrue(records[0]["ok"])
        self.assertIn("ts", records[0])

    def test_error_level_skips_success(self):
        config = copy.deepcopy(BASE_CONFIG)
        config["log"]["level"] = "error"
        self.write_config(config)
        self.run_cli()
        self.assertEqual(self.log_records(), [])

        senders = {
            "email": self.fake_sender("email"),
            "push": self.fake_sender("push", fail=True),
        }
        event = base_event()
        event["key"] = "k-2"
        self.run_cli(event=event, senders=senders)
        records = self.log_records()
        self.assertEqual(len(records), 3)
        self.assertTrue(all(not record["ok"] for record in records))


class TestInputErrors(Base):
    def test_missing_data_field(self):
        event = base_event()
        event["event"] = "需要你答"
        event["data"] = {
            "customer": "B 店",
            "requirement": "预约送货",
            "question": "选哪个",
        }
        code, out, err = self.run_cli(event=event)
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("recommended", err)
        self.assertEqual(self.sent, [])

    def test_unknown_event(self):
        event = base_event()
        event["event"] = "不存在的通知"
        code, _, err = self.run_cli(event=event)
        self.assertEqual(code, 2)
        self.assertIn("未知事件", err)

    def test_bad_version(self):
        event = base_event()
        event["v"] = 2
        code, _, err = self.run_cli(event=event)
        self.assertEqual(code, 2)
        self.assertIn("v", err)

    def test_float_version_rejected(self):
        event = base_event()
        event["v"] = 1.0
        code, _, err = self.run_cli(event=event)
        self.assertEqual(code, 2)
        self.assertIn("整数", err)

    def test_bad_json(self):
        path = self.home / "bad.json"
        path.write_text("{not json", encoding="utf-8")
        code, _, err = self.run_cli(event_path=path)
        self.assertEqual(code, 2)
        self.assertIn("JSON", err)

    def test_missing_config(self):
        empty_home = Path(tempfile.mkdtemp(prefix="notifier-empty-"))
        code, _, err = self.run_cli(home=empty_home)
        self.assertEqual(code, 2)
        self.assertIn("找不到配置文件", err)
        self.assertEqual(self.sent, [])


def orca_config():
    config = copy.deepcopy(BASE_CONFIG)
    config["channels"]["orca_bot"] = {
        "enabled": True,
        "bot": "莹宝（AFK）",
        "timeout_seconds": 5,
    }
    return config


def proposal_event():
    return {
        "v": 1,
        "key": "k-orca-proposal",
        "event": "补缺口提案",
        "occurred_at": "2026-11-24T12:00:00+08:00",
        "link": "https://github.com/acme/demo/issues/42",
        "data": {
            "customer": "B 店",
            "requirement": "预约送货",
            "question_count": 2,
            "owner": "acme",
            "repo": "demo",
            "ticket": 42,
            "kind": "gap",
            "comment_url": "https://github.com/acme/demo/issues/42#issuecomment-9",
        },
    }


def deployed_event():
    return {
        "v": 1,
        "key": "k-deploy",
        "event": "部署完成",
        "occurred_at": "2026-11-24T12:00:00+08:00",
        "link": "https://github.com/acme/demo/issues/42",
        "data": {
            "customer": "B 店",
            "requirement": "预约送货",
            "address": "https://b-shop.example.test",
        },
    }


class TestOrcaBotChannel(Base):
    def setUp(self):
        super().setUp()
        self.write_config(orca_config())

    def all_senders(self, orca_fails=False):
        return {
            "email": self.fake_sender("email"),
            "push": self.fake_sender("push"),
            "orca_bot": self.fake_sender("orca_bot", fail=orca_fails),
        }

    def channels_sent(self):
        return [row[0] for row in self.sent]

    def test_proposal_goes_to_all_three_channels(self):
        code, out, _ = self.run_cli(
            event=proposal_event(), senders=self.all_senders())
        self.assertEqual(code, 0)
        self.assertEqual(self.channels_sent(), ["push", "email", "orca_bot"])
        result = json.loads(out)
        self.assertEqual(
            [row["channel"] for row in result["results"]],
            ["push", "email", "orca_bot"],
        )

    def test_deployed_has_no_email(self):
        code, _, _ = self.run_cli(
            event=deployed_event(), senders=self.all_senders())
        self.assertEqual(code, 0)
        self.assertEqual(self.channels_sent(), ["push", "orca_bot"])

    def test_orca_bot_failure_keeps_other_channels_and_exit_1(self):
        code, out, _ = self.run_cli(
            event=proposal_event(), senders=self.all_senders(orca_fails=True))
        self.assertEqual(code, 1)
        self.assertEqual(
            self.channels_sent(), ["push", "email", "orca_bot", "orca_bot", "orca_bot"])
        result = json.loads(out)
        failed = [row for row in result["results"] if not row["ok"]]
        self.assertEqual([row["channel"] for row in failed], ["orca_bot"])
        records = [
            row for row in self.log_records()
            if row.get("channel") == "orca_bot" and row.get("ok") is False
        ]
        self.assertEqual(len(records), 3)
        self.assertEqual(records[-1]["attempts"], 3)

    def test_channel_flag_sends_only_orca_bot(self):
        code, _, _ = self.run_cli(
            "--channel", "orca_bot", event=proposal_event(),
            senders=self.all_senders())
        self.assertEqual(code, 0)
        self.assertEqual(self.channels_sent(), ["orca_bot"])

    def test_orca_bot_does_not_read_keychain(self):
        def secret_reader(service):
            raise AssertionError(f"orca_bot 不该读钥匙串：{service}")

        code, _, err = self.run_cli(
            "--channel", "orca_bot", event=proposal_event(),
            senders=self.all_senders(), secret_reader=secret_reader)
        self.assertEqual(code, 0, err)
        self.assertEqual(self.channels_sent(), ["orca_bot"])

    def test_disabled_orca_bot_keeps_original_channels(self):
        self.write_config(BASE_CONFIG)
        code, _, _ = self.run_cli(
            event=proposal_event(), senders=self.all_senders())
        self.assertEqual(code, 0)
        self.assertEqual(self.channels_sent(), ["push", "email"])

    def test_enabled_config_without_bot_is_bad_input(self):
        config = orca_config()
        del config["channels"]["orca_bot"]["bot"]
        self.write_config(config)
        code, _, err = self.run_cli(
            event=proposal_event(), senders=self.all_senders())
        self.assertEqual(code, 2)
        self.assertIn("bot", err)
        self.assertEqual(self.sent, [])


if __name__ == "__main__":
    unittest.main()
