"""失败处理演练：用假通道跑真实入口，日志留在临时目录里给运营者看。

只用于 I-0120 的验收。假通道模拟 webhook 非 200 和断线，不联网，
不碰 ~/.grilling/notifier/，也不是调度器：每一步都是手工指定的事件。
24 小时重复用两次调用加短间隔模拟，key 和已等天数由这里签。
"""
from __future__ import annotations

import argparse
import json
import tempfile
import time
from pathlib import Path

from .. import __main__ as cli
from ..channels import ChannelError

CONFIG = {
    "channels": {
        "email": {
            "enabled": True,
            "to": "ops@example.com",
            "from": "notify@example.com",
            "host": "smtp.example.com",
            "port": 465,
            "timeout_seconds": 5,
        },
        "push": {"enabled": True, "timeout_seconds": 5},
    },
    "log": {"level": "info"},
    "retry": {"attempts": 3, "interval_seconds": 0.05},
}


class FakeChannel:
    """按脚本失败：none 正常，http502 非 200，disconnect 断线。"""

    def __init__(self, name):
        self.name = name
        self.script: list[str] = []
        self.calls = []
        self.bodies = []

    def __call__(self, config, title, body, secret):
        self.calls.append(title)
        self.bodies.append(body)
        action = self.script.pop(0) if self.script else "none"
        if action == "http502":
            raise ChannelError("HTTP 502")
        if action == "disconnect":
            raise ChannelError("URLError: 连接被拒绝")


def event(key, name="新单进队列", customer="演练店", days=None, incident=False):
    data = {"customer": customer, "requirement": "演练需求"}
    if incident:
        data.update({"reason": "同类两次", "tried": "重跑一次"})
    if days is not None:
        data["days_waited"] = days
    return {
        "v": 1,
        "key": key,
        "event": name,
        "occurred_at": "2026-11-16T12:00:00+08:00",
        "link": "https://example.test/1",
        "data": data,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python3 -m notifier.dev.failure_drill")
    parser.add_argument("--home", help="日志和状态放哪，默认新建临时目录")
    parser.add_argument("--interval", type=float, default=0.05,
                        help="重试间隔和 24 小时模拟间隔，默认 0.05 秒")
    args = parser.parse_args(argv)

    home = Path(args.home) if args.home else Path(
        tempfile.mkdtemp(prefix="notifier-drill-"))
    home.mkdir(parents=True, exist_ok=True)
    config = json.loads(json.dumps(CONFIG))
    config["retry"]["interval_seconds"] = args.interval
    (home / "config.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"演练目录：{home}")

    push = FakeChannel("push")
    email = FakeChannel("email")

    def step(label, item, push_script=None, email_script=None):
        push.script = list(push_script or [])
        email.script = list(email_script or [])
        event_path = home / "event.json"
        event_path.write_text(
            json.dumps(item, ensure_ascii=False), encoding="utf-8")
        code = cli.run(
            ["send", "--event-file", str(event_path)],
            home=str(home),
            secret_reader=lambda service: "drill-secret",
            senders={"email": email, "push": push},
        )
        print(f"\n== {label} ==\n退出码 {code}")
        last = json.loads((home / "notify.log").read_text(
            encoding="utf-8").strip().splitlines()[-1])
        print(f"最后一条日志：{json.dumps(last, ensure_ascii=False)}")

    step("1 正常推送", event("drill-1"))
    step("2 模拟非 200：前两次失败，第三次成功（重试与退避）",
         event("drill-2"), push_script=["http502", "http502"])
    step("3 推送连续失败 3 次：发「通知通道可能断了」邮件",
         event("drill-3"), push_script=["http502"] * 3)
    step("4 出事且推送失败：邮件腿兜底，日志写 fallback",
         event("drill-4", name="出事", incident=True),
         push_script=["http502"] * 3)
    step("5 两路都断：日志写「通道断了」，事件留在待补发",
         event("drill-5", name="出事", incident=True),
         push_script=["disconnect"] * 3, email_script=["disconnect"])
    step("6 推送恢复：补发待补发事件", event("drill-6", customer="恢复店"))
    step("7 邮件恢复：补发只差邮件的事件（点火超时走邮件）",
         event("drill-7", name="点火超时", customer="恢复店"))

    days = event("drill-day-0", customer="重复店")
    step("8a 等人的待办：第一天", days)
    time.sleep(args.interval)
    repeat = event("drill-day-1", customer="重复店", days=1)
    step("8b 24 小时后换 key 重发（用短间隔模拟）", repeat)
    print("\n第二次正文：", push.bodies[-1])
    print("已等 N 天是否进正文：", "已等 1 天。" in push.bodies[-1])

    print(f"\n== 全部日志 {home / 'notify.log'} ==")
    print((home / "notify.log").read_text(encoding="utf-8"))
    state = json.loads((home / "state.json").read_text(encoding="utf-8"))
    print(f"== 状态 ==\n已推 key：{sorted(state['sent'])}")
    print(f"待补发 key：{sorted(state['pending'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
