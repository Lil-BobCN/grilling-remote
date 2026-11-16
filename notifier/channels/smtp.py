"""邮件通道：阿里云邮件推送 SMTP（SSL 465）。"""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from ..config import EmailConfig
from . import ChannelError


def send(config: EmailConfig, title: str, body: str, secret: str) -> None:
    message = EmailMessage()
    message["From"] = config.sender
    message["To"] = config.recipient
    message["Subject"] = title
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=config.sender.split("@", 1)[-1])
    message.set_content(body)

    context = ssl.create_default_context()
    try:
        with smtplib.SMTP_SSL(
            config.host, config.port, timeout=config.timeout, context=context
        ) as smtp:
            # 阿里云拒绝一次性的 AUTH PLAIN，必须走两步挑战认证
            smtp.login(config.sender, secret, initial_response_ok=False)
            smtp.send_message(message)
    except Exception as exc:
        raise ChannelError(f"{type(exc).__name__}: {exc}") from exc
