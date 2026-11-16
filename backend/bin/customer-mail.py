#!/usr/bin/env python3
"""发一封客户邮件。正文从标准输入读，渲染在 Node 侧完成。

用法（在服务器上，环境变量里放 SMTP 配置）：

    python3 customer-mail.py --to boss@example.com --subject "主题" --body-stdin < body.txt
    python3 customer-mail.py --dry-run --to boss@example.com --subject "主题" --body-file body.txt

环境变量：
    SMTP_HOST      SMTP 服务器，例如 smtpdm.aliyun.com
    SMTP_PORT      端口，默认 465（SSL）
    SMTP_USER      登录名和默认发件地址
    SMTP_PASSWORD  密码
    SMTP_FROM      发件地址，默认用 SMTP_USER

阿里云 SMTP 的已知问题：smtplib 默认的一次性 AUTH PLAIN 会被拒（535）。
登录时传 initial_response_ok=False，让它按服务器支持的步骤协商。
"""

import argparse
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage


def read_body(args):
    if args.body_stdin:
        return sys.stdin.read()
    if args.body_file:
        with open(args.body_file, "r", encoding="utf-8") as handle:
            return handle.read()
    raise SystemExit("缺正文：用 --body-stdin 或 --body-file")


def build_message(args, body):
    sender = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER") or ""
    message = EmailMessage()
    message["From"] = sender
    message["To"] = args.to
    message["Subject"] = args.subject
    message.set_content(body)
    return message


def main():
    parser = argparse.ArgumentParser(description="发一封客户邮件")
    parser.add_argument("--to", required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body-stdin", action="store_true")
    parser.add_argument("--body-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    body = read_body(args)
    message = build_message(args, body)

    if args.dry_run:
        print(f"To: {args.to}")
        print(f"Subject: {args.subject}")
        print(f"From: {message['From'] or '(未配置 SMTP_FROM / SMTP_USER)'}")
        print()
        print(body)
        return

    host = os.environ.get("SMTP_HOST", "")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASSWORD", "")
    missing = [name for name, value in (("SMTP_HOST", host), ("SMTP_USER", user), ("SMTP_PASSWORD", password)) if not value]
    if missing:
        raise SystemExit(f"缺 SMTP 配置：{', '.join(missing)}")

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, timeout=30, context=context) as server:
        server.login(user, password, initial_response_ok=False)
        server.send_message(message)


if __name__ == "__main__":
    main()
