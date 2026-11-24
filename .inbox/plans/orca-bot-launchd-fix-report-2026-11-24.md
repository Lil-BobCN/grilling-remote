# I-0269 修复记录：orca_bot 通道从 launchd 发不出去

票：GitHub #627 / 中台 I-0269，父地图 I-0208。
分支 `Lil-BobCN/orca_bot-launchd-chat`，基线本地 main `8129572`。
日期：2026-11-24。

一句话：orca_bot 通道补了发件人 `sender`（`--from`）和 chat 标题前缀匹配；从 launchd 同款环境复跑，退出码 0，两次叫醒进同一个 chat。

## 一、发送方

运营者选定新开专用通知 bot，不向目标 bot 自己发。

| 项 | 值 |
| --- | --- |
| bot 名 | 工厂通知 |
| bot id | `400bfe9e-1663-4419-95e8-de3468335454` |
| 创建方式 | `orca bot create --offer` 的卡片由莹宝的 chat 出给运营者，运营者点 Create bot |
| 探测 | `orca orchestration send --to "bot:莹宝（AFK）" --from "bot:400bfe9e-…" --type status`，退出码 0，messageId `msg_865fb3d39972` |

## 二、代码改动

| 文件 | 改动 |
| --- | --- |
| `notifier/config.py` | `OrcaBotConfig` 增加 `sender`；开启 `orca_bot` 时必填，缺了在加载配置阶段报错 |
| `notifier/channels/orca_bot.py` | 发送时传 `--from <sender>`；缺 sender 直接报错；发送错误把 sender 替换成 `<发件人>` |
| `notifier/chat_titles.py` | 增加 `BOT_CHAT_TITLE_PREFIX` 和 `chat_title_matches` |
| `notifier/config.example.json` | 示例加 `sender` |
| `docs/通知.md` | 配置项、前缀匹配、脱敏说明 |
| `notifier/tests/test_config.py` | 缺 sender、读 sender |
| `notifier/tests/test_orca_bot.py` | `--from` 传值、前缀命中、重复叫醒同 chat、前缀标题不串父工单、缺 sender、错误脱敏 |
| `notifier/tests/test_cli.py` | 测试 config 加 sender |

## 三、测试

```bash
python3 -m unittest discover -s notifier/tests
```

111 项通过，0 失败。

## 四、launchd 同款环境复跑

临时 `NOTIFIER_HOME`：`/tmp/i0269-notifier-20261124`。配置里 `orca_bot` 开，邮件和推送关，`sender` 填 `bot:400bfe9e-1663-4419-95e8-de3468335454`，重试 1 次。

命令：

```bash
env -i HOME="$HOME" PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  NOTIFIER_HOME="/tmp/i0269-notifier-20261124" \
  /bin/bash -c 'set -a; . "$HOME/.afkfactory/env"; set +a; \
  cd "/Users/Admin/orca/workspaces/grilling 远程/orca_bot-launchd-chat"; \
  /usr/bin/python3 -m notifier send --event-file /tmp/i0269-notifier-20261124/event-1.json --channel orca_bot'
```

`env -i` 清掉了 `ORCA_TERMINAL_HANDLE`，和 launchd 一致。

| 次数 | 事件 key | 退出码 | 通道结果 | 落点 |
| --- | --- | --- | --- | --- |
| 1 | `…:i0269-launchd-check-1` | 0 | ok，413ms | chat `3ee2d30c-5d14-4b25-ac35-def729852b0e`，标题 `your owner's agent: 补缺口 Lil-BobCN/scratch-bot-sim#92` |
| 2 | `…:i0269-launchd-check-2` | 0 | ok，689ms | 同一个 chat `3ee2d30c-5d14-4b25-ac35-def729852b0e` |

chat 数量运行前后都是 3（Home、#92 补缺口、工厂工作台自检），没有新开 chat。两次消息的 From 都是 `BOT:400BFE9E-1663-4419-95E8-DE3468335454`（工厂通知）。

bot 收到 handoff 后已回：`lastSaid` 开头是「已读完题，先把结论说清楚：**还没写回，等你确认。**」，内容是 issue 92 的补缺口提案复述。叫醒链路完整走通。

日志 `/tmp/i0269-notifier-20261124/notify.log` 两行都是 `ok: true`，没有 sender 明文。

## 五、隔离

| 主路径 | 结果 |
| --- | --- |
| `~/.grilling/notifier/config.json` | mtime 1794812304、size 347，和 I-0263 基线 1794812304809/347 一致；没读内容，没改 |
| 主 launchd plist | 没改，没重装；mtime 仍是 11 月 23 日 02:25 |
| `~/.afkfactory/jobs.json` | 本轮只在 `/tmp` 和仓库工作区写；mtime 变化来自生产调度器，不是本轮 |
| `~/.grilling/factory/locks` | mtime 1795460626，和 I-0268 基线一致，没写 |

## 六、偏离和没证据

1. 第二次叫醒用的是同一类 `补缺口提案` 事件、不同 key，不是 24 小时重发路径。
2. 主 config 的 `orca_bot` 是否真的关着：按要求不读内容，只核对 mtime 和 size。

## 七、后续

按票面流程：

1. 本票修完、合并后关闭。关闭只代表修完，不代表 I-0263 通过。
2. 本票关闭后，回 I-0263 重跑第 1 项；通过才关 I-0263。
3. I-0263 关之前不开 I-0264。
4. 主 config 的 `orca_bot` 保持关闭，等复验通过、第五次演练前由运营者开。
