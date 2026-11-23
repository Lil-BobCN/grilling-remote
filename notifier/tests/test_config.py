"""配置读取测试：重试参数默认值和校验。"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from notifier.config import ConfigError, load_config

BASE = {
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
}


class TestRetryConfig(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="notifier-config-"))

    def write(self, config):
        (self.home / "config.json").write_text(
            json.dumps(config, ensure_ascii=False), encoding="utf-8")

    def test_defaults_when_missing(self):
        self.write(BASE)
        config = load_config(str(self.home))
        self.assertEqual(config.retry.attempts, 3)
        self.assertEqual(config.retry.interval_seconds, 30.0)

    def test_custom_values(self):
        data = {**BASE, "retry": {"attempts": 5, "interval_seconds": 0.5}}
        self.write(data)
        config = load_config(str(self.home))
        self.assertEqual(config.retry.attempts, 5)
        self.assertEqual(config.retry.interval_seconds, 0.5)

    def test_zero_interval_allowed(self):
        data = {**BASE, "retry": {"attempts": 1, "interval_seconds": 0}}
        self.write(data)
        config = load_config(str(self.home))
        self.assertEqual(config.retry.interval_seconds, 0.0)

    def test_bad_attempts(self):
        for value in (0, -1, True, 1.5, "3"):
            data = {**BASE, "retry": {"attempts": value, "interval_seconds": 0}}
            self.write(data)
            with self.assertRaises(ConfigError):
                load_config(str(self.home))

    def test_bad_interval(self):
        for value in (-1, True, "30"):
            data = {**BASE, "retry": {"attempts": 3, "interval_seconds": value}}
            self.write(data)
            with self.assertRaises(ConfigError):
                load_config(str(self.home))


class TestOrcaBotConfig(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="notifier-config-"))

    def write(self, config):
        (self.home / "config.json").write_text(
            json.dumps(config, ensure_ascii=False), encoding="utf-8")

    def test_missing_block_means_disabled(self):
        self.write(BASE)
        config = load_config(str(self.home))
        self.assertFalse(config.orca_bot.enabled)
        self.assertEqual(config.orca_bot.command, "orca")

    def test_enabled_reads_bot_timeout_and_command(self):
        data = json.loads(json.dumps(BASE))
        data["channels"]["orca_bot"] = {
            "enabled": True,
            "bot": "莹宝（AFK）",
            "timeout_seconds": 20,
            "command": "/opt/orca/bin/orca",
        }
        self.write(data)
        config = load_config(str(self.home))
        self.assertTrue(config.orca_bot.enabled)
        self.assertEqual(config.orca_bot.bot, "莹宝（AFK）")
        self.assertEqual(config.orca_bot.timeout, 20.0)
        self.assertEqual(config.orca_bot.command, "/opt/orca/bin/orca")

    def test_enabled_requires_bot_name(self):
        for block in (
            {"enabled": True, "timeout_seconds": 20},
            {"enabled": True, "bot": "", "timeout_seconds": 20},
            {"enabled": True, "bot": "  ", "timeout_seconds": 20},
        ):
            with self.subTest(block=block):
                data = json.loads(json.dumps(BASE))
                data["channels"]["orca_bot"] = block
                self.write(data)
                with self.assertRaises(ConfigError) as raised:
                    load_config(str(self.home))
                self.assertIn("bot", str(raised.exception))

    def test_enabled_requires_positive_timeout(self):
        data = json.loads(json.dumps(BASE))
        data["channels"]["orca_bot"] = {
            "enabled": True, "bot": "afk", "timeout_seconds": 0,
        }
        self.write(data)
        with self.assertRaises(ConfigError):
            load_config(str(self.home))

    def test_bad_enabled_and_command(self):
        for block in (
            {"enabled": "true", "bot": "afk", "timeout_seconds": 20},
            {"enabled": True, "bot": "afk", "timeout_seconds": 20,
             "command": ""},
        ):
            with self.subTest(block=block):
                data = json.loads(json.dumps(BASE))
                data["channels"]["orca_bot"] = block
                self.write(data)
                with self.assertRaises(ConfigError):
                    load_config(str(self.home))


if __name__ == "__main__":
    unittest.main()
