"""失败处理测试：重试、退避、转邮件、告警、去重、补发和 24 小时重复契约。"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from notifier import state as state_module
from notifier import __main__ as cli
from notifier.channels import ChannelError

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


def push_event(key="k-1", customer="B 店", days=None):
    data = {"customer": customer, "requirement": "预约送货"}
    if days is not None:
        data["days_waited"] = days
    return {
        "v": 1,
        "key": key,
        "event": "新单进队列",
        "occurred_at": "2026-11-16T12:00:00+08:00",
        "link": "https://example.test/1",
        "data": data,
    }


def incident_event(key="k-1"):
    return {
        "v": 1,
        "key": key,
        "event": "出事",
        "occurred_at": "2026-11-16T12:00:00+08:00",
        "link": "https://example.test/1",
        "data": {
            "customer": "B 店",
            "requirement": "预约送货",
            "reason": "同类两次",
            "tried": "重跑一次仍未过",
        },
    }


class Clock:
    def __init__(self, now=None):
        self.now = now or datetime.fromisoformat("2026-11-16T12:00:00+08:00")

    def __call__(self):
        return self.now

    def advance_days(self, days):
        self.now = self.now + timedelta(days=days)


class Sender:
    """可切换成败的假通道，记录每次调用的标题。"""

    def __init__(self, outcomes=None):
        self.outcomes = list(outcomes or [])
        self.calls = []

    def should_fail(self):
        if not self.outcomes:
            self.outcomes.append(True)
        return not self.outcomes.pop(0)

    def __call__(self, config, title, body, secret, event=None):
        self.calls.append({"title": title, "body": body})
        if self.should_fail():
            raise ChannelError("HTTP 502")


class Base(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="notifier-failure-"))
        self.write_config()
        self.clock = Clock()
        self.email = Sender()
        self.push = Sender()

    def write_config(self, config=None):
        (self.home / "config.json").write_text(
            json.dumps(config or BASE_CONFIG, ensure_ascii=False),
            encoding="utf-8",
        )

    def event_file(self, event):
        path = self.home / "event.json"
        path.write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8")
        return path

    def run_cli(self, event, *extra):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.run(
                ["send", "--event-file", str(self.event_file(event)), *extra],
                home=str(self.home),
                secret_reader=lambda service: "secret",
                senders={"email": self.email, "push": self.push},
                clock=self.clock,
            )
        return code, out.getvalue(), err.getvalue()

    def logs(self):
        path = self.home / "notify.log"
        if not path.exists():
            return []
        return [json.loads(line) for line in
                path.read_text(encoding="utf-8").splitlines()]

    def state(self):
        state, error = state_module.load(self.home)
        self.assertIsNone(error)
        return state

    def alert_calls(self):
        return [call for call in self.email.calls
                if call["title"] == "通知通道可能断了"]


class TestRetry(Base):
    def test_retry_logs_attempts_and_backoff(self):
        self.push.outcomes = [False, False, True]
        code, out, _ = self.run_cli(push_event())
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertTrue(result["results"][0]["ok"])
        attempts = [record for record in self.logs() if "attempt" in record]
        self.assertEqual([record["attempt"] for record in attempts], [1, 2, 3])
        self.assertFalse(attempts[0]["ok"])
        self.assertEqual(attempts[0]["retry_in"], 0)
        self.assertTrue(attempts[2]["ok"])

    def test_email_is_not_retried(self):
        self.email.outcomes = [False]
        code, out, _ = self.run_cli({
            **push_event("k-1"),
            "event": "点火超时",
        })
        self.assertEqual(code, 1)
        self.assertEqual(len(self.email.calls), 1)
        record = [item for item in self.logs() if item.get("channel") == "email"]
        self.assertEqual(record[0]["attempts"], 1)

    def test_three_failures_exit_1(self):
        self.push.outcomes = [False, False, False]
        code, out, _ = self.run_cli(push_event())
        self.assertEqual(code, 1)
        self.assertEqual(len(self.push.calls), 3)
        self.assertFalse(json.loads(out)["results"][0]["ok"])


class TestDedup(Base):
    def test_duplicate_key_skipped(self):
        self.run_cli(push_event())
        code, out, _ = self.run_cli(push_event())
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out)["skipped"])
        self.assertEqual(len(self.push.calls), 1)
        self.assertTrue(any(record.get("phase") == "skip" for record in self.logs()))

    def test_failed_key_retried_next_run(self):
        self.push.outcomes = [False, False, False]
        code, _, _ = self.run_cli(push_event())
        self.assertEqual(code, 1)
        self.push.outcomes = [True]
        code, out, _ = self.run_cli(push_event())
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(out)["skipped"])
        self.assertEqual(len(self.push.calls), 4)

    def test_partial_delivery_only_retries_failed_channel(self):
        self.push.outcomes = [False, False, False]
        code, _, _ = self.run_cli(incident_event())
        self.assertEqual(code, 1)
        self.assertEqual(self.email.calls[0]["title"],
                         "B 店 · 预约送货 · 卡住：同类两次")
        self.assertEqual(len(self.alert_calls()), 1)
        self.clear_logs()
        self.push.outcomes = [True]
        self.email.calls.clear()
        self.push.calls.clear()
        code, _, _ = self.run_cli(incident_event())
        self.assertEqual(code, 0)
        self.assertEqual(self.email.calls, [])
        self.assertEqual(len(self.push.calls), 1)

    def clear_logs(self):
        (self.home / "notify.log").unlink(missing_ok=True)


class TestAlert(Base):
    def test_alert_once_per_day(self):
        self.push.outcomes = [False] * 6
        self.run_cli(push_event("k-1"))
        self.assertEqual(len(self.alert_calls()), 1)
        self.run_cli(push_event("k-2"))
        self.assertEqual(len(self.alert_calls()), 1)
        self.clock.advance_days(1)
        self.push.outcomes = [False] * 3
        self.run_cli(push_event("k-3"))
        self.assertEqual(len(self.alert_calls()), 2)

    def test_alert_needs_three_consecutive_failures(self):
        config = copy.deepcopy(BASE_CONFIG)
        config["retry"]["attempts"] = 1
        self.write_config(config)
        self.push.outcomes = [False, False]
        self.run_cli(push_event("k-1"))
        self.run_cli(push_event("k-2"))
        self.assertEqual(self.alert_calls(), [])
        self.push.outcomes = [False]
        self.run_cli(push_event("k-3"))
        self.assertEqual(len(self.alert_calls()), 1)
        alert = self.alert_calls()[0]
        self.assertIn("连续失败 3 次", alert["body"])

    def test_success_resets_consecutive_count(self):
        config = copy.deepcopy(BASE_CONFIG)
        config["retry"]["attempts"] = 2
        self.write_config(config)
        self.push.outcomes = [False, False]
        self.run_cli(push_event("k-1"))
        self.push.outcomes = [True]
        self.run_cli(push_event("k-2"))
        self.push.outcomes = [False, False]
        self.run_cli(push_event("k-3"))
        self.assertEqual(self.alert_calls(), [])

    def test_channel_override_does_not_send_alert(self):
        self.push.outcomes = [False, False, False]
        self.run_cli(push_event(), "--channel", "push")
        self.assertEqual(self.alert_calls(), [])


class TestOutageAndResend(Base):
    def test_both_channels_down_logs_outage(self):
        self.email.outcomes = [False]
        self.push.outcomes = [False, False, False]
        code, _, _ = self.run_cli(incident_event())
        self.assertEqual(code, 1)
        outage = [record for record in self.logs()
                  if record.get("phase") == "outage"]
        self.assertEqual(len(outage), 1)
        self.assertEqual(outage[0]["message"], "通道断了")
        state = self.state()
        self.assertIn("k-1", state["pending"])

    def test_both_channels_down_includes_alert_failure(self):
        self.push.outcomes = [False, False, False]
        self.email.outcomes = [False, False]  # 出事邮件和告警邮件都发不出去
        self.run_cli(push_event())
        outage = [record for record in self.logs()
                  if record.get("phase") == "outage"]
        self.assertEqual(len(outage), 1)

    def test_resend_after_recovery_once(self):
        self.push.outcomes = [False, False, False]
        self.run_cli(push_event("k-1", customer="A 店"))
        self.assertIn("k-1", self.state()["pending"])
        self.push.outcomes = [True]
        self.run_cli(push_event("k-2", customer="B 店"))
        titles = [call["title"] for call in self.push.calls]
        self.assertEqual(titles[-2:], [
            "B 店 · 预约送货 · 已进队列",
            "A 店 · 预约送货 · 已进队列",
        ])
        resent = [record for record in self.logs()
                  if record.get("phase") == "resend"]
        self.assertEqual(len(resent), 1)
        self.assertTrue(resent[0]["ok"])
        state = self.state()
        self.assertIn("k-1", state["sent"])
        self.assertEqual(state["pending"], {})
        self.push.outcomes = [True]
        self.run_cli(push_event("k-3", customer="C 店"))
        self.assertEqual(
            len([call for call in self.push.calls
                 if call["title"].startswith("A 店")]), 4)

    def test_crash_after_send_duplicates_at_most_once(self):
        state = state_module.empty_state()
        event = push_event("k-crash", customer="A 店")
        state_module.ensure_pending(state, event, self.clock())
        state_module.mark_failed(
            state, "k-crash", "push", "HTTP 502", 3, self.clock())
        self.assertIn("k-crash", state["pending"])
        state_module.save(self.home, state)

        self.push.outcomes = [True]
        self.run_cli(push_event("k-2", customer="B 店"))
        self.assertEqual(
            len([call for call in self.push.calls
                 if call["title"].startswith("A 店")]), 1)
        self.assertEqual(self.state()["pending"], {})
        self.push.outcomes = [True]
        self.run_cli(push_event("k-3", customer="C 店"))
        self.assertEqual(
            len([call for call in self.push.calls
                 if call["title"].startswith("A 店")]), 1)


class TestRepeatContract(Base):
    def test_new_key_same_content_is_delivered_with_days(self):
        self.run_cli(push_event("day-0"))
        self.run_cli(push_event("day-1", days=1))
        self.assertEqual(len(self.push.calls), 2)
        self.assertIn("已等 1 天。", self.push.calls[1]["body"])
        code, out, _ = self.run_cli(push_event("day-1", days=1))
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out)["skipped"])
        self.assertEqual(len(self.push.calls), 2)


class TestStateHousekeeping(Base):
    def test_prune_drops_old_entries(self):
        state = state_module.empty_state()
        old = self.clock.now.replace(year=2026, month=11, day=1)
        state["sent"]["old-sent"] = {"at": old.isoformat(), "event": "新单进队列"}
        state["pending"]["old-pending"] = {
            "event": push_event("old-pending"),
            "created_at": old.isoformat(),
            "delivered": {},
            "failed": {"push": {"error": "x", "at": old.isoformat()}},
        }
        state_module.save(self.home, state)
        self.run_cli(push_event("k-new"))
        state = self.state()
        self.assertNotIn("old-sent", state["sent"])
        self.assertNotIn("old-pending", state["pending"])
        self.assertTrue(any(record.get("phase") == "prune" for record in self.logs()))

    def test_corrupt_state_starts_fresh(self):
        (self.home / "state.json").write_text("{not json", encoding="utf-8")
        code, _, _ = self.run_cli(push_event())
        self.assertEqual(code, 0)
        self.assertTrue(any(record.get("phase") == "state_error"
                            for record in self.logs()))
        self.assertIn("k-1", self.state()["sent"])

    def test_save_leaves_no_temp_files(self):
        self.run_cli(push_event())
        leftovers = list(self.home.glob(".state-*.tmp"))
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
