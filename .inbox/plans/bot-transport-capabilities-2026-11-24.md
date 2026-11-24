# I-0263 能力检查记录

票：GitHub #621 / 中台 I-0263「模拟前置：叫醒、token、手机、额度」。
日期：2026-11-24。
环境：I-0268 的 scratch 仓 `Lil-BobCN/scratch-bot-sim`、临时 `NOTIFIER_HOME`（`issue-0268/factory/test/sim/.state/notifier/`）、集成分支 `bot-transport-integration` 的 notifier 代码。
主 config 没读没改。主 launchd、主作业表、主锁目录没碰。

一句话：token、手机、模型三项通过；从 launchd 叫醒最初不过，I-0269 修复后复验通过。四项全部通过。

## 1. launchd 环境叫醒：起初不过，I-0269 修复后通过

### 1.1 测试 config 的 bot 名是占位符

临时 config 原本写 `"bot": "afk"`。真 Orca 里没有这个 bot，实际名字是 `莹宝（AFK）`。

命令（launchd 同款 PATH，source `~/.afkfactory/env`）：

```bash
env -i HOME="$HOME" PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  NOTIFIER_HOME="<临时>" REPO="<集成分支 worktree>" \
  /bin/bash -c 'set -a; . "$HOME/.afkfactory/env"; set +a; cd "$REPO"; \
  /usr/bin/python3 -m notifier send --event-file /tmp/bot-cap-2026-11-24/gap-92.json --channel orca_bot'
```

输出（2026-11-24T09:56:48+08:00）：

```json
{"key":"lil-bobcn/scratch-bot-sim:#92:补缺口提案:cap-check-1","skipped":false,"results":[{"channel":"orca_bot","ok":false,"ms":307}]}
```

退出码 1。日志：

```text
ChannelError: orca bot chats 失败：No bot named afk
```

### 1.2 改成真名后，卡在发送方身份

把临时 config 的 `bot` 改成 `莹宝（AFK）`（备份 `config.json.before-cap-check`），重跑，不加 `--channel`：

```json
{"key":"lil-bobcn/scratch-bot-sim:#92:补缺口提案:cap-check-launchd-1","skipped":false,"results":[{"channel":"orca_bot","ok":false,"ms":415}]}
```

退出码 1（2026-11-24T09:56:57+08:00）。日志：

```text
ChannelError: orca orchestration send 失败：Could not determine the calling terminal for this orchestration command.
Pass --from with your own terminal's handle — another pane's handle would act on its mailbox —
or run the command inside a live Orca terminal with ORCA_TERMINAL_HANDLE set.
```

原因：

- launchd 起的进程没有 `ORCA_TERMINAL_HANDLE`。生产调度器进程里也没有（`ps eww` 计数 0；`launchctl print` 只看到 PATH）。
- 仓库目录下同时开着多个 Orca 终端，CLI 不能唯一推断发送方。
- notifier 的 `orca_bot` 通道调 `orca orchestration send` 时没有传 `--from`。见 `notifier/channels/orca_bot.py` 的 `_run` 调用。

手工补发送方身份可以发出去：

```bash
orca orchestration send --to "bot:莹宝（AFK）" --type status \
  --subject "能力检查：发送方身份探测" --body "..." \
  --from bot:b3258c07-6bf2-4df0-a8e7-b4d1334e8009 --json
```

输出 `{"ok":true,"result":{"messageId":"msg_0f0e978dd28a",...}}`，退出码 0，消息进了 bot 的 Home Chat。

### 1.3 chat 标题对不上

手工用 `--chat new --subject "补缺口 Lil-BobCN/scratch-bot-sim#92"` 开的 chat，实际标题是：

```text
your owner's agent: 补缺口 Lil-BobCN/scratch-bot-sim#92
```

`_find_chat` 是精确比较 `row.get("title") == title`，期望 `补缺口 Lil-BobCN/scratch-bot-sim#92`。前缀在，永远匹配不上，每次叫醒都会新开一个 chat。

### 1.4 复验（2026-11-24 10:41，I-0269 修复后）

I-0269（GitHub #627）合并后复验。代码是 PR #628 的 head `7b1c4e0`，已合入 `drill4-repair-plan` 的合并提交 `5ca75d7`。临时 `NOTIFIER_HOME`：`/tmp/i0269-notifier-20261124`，配置里 `orca_bot` 开，`sender` 填 `bot:400bfe9e-1663-4419-95e8-de3468335454`（专用 bot「工厂通知」）。

命令：

```bash
env -i HOME="$HOME" PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  NOTIFIER_HOME="/tmp/i0269-notifier-20261124" \
  /bin/bash -c 'set -a; . "$HOME/.afkfactory/env"; set +a; \
  cd "/Users/Admin/orca/workspaces/grilling 远程/orca_bot-launchd-chat"; \
  /usr/bin/python3 -m notifier send --event-file /tmp/i0269-notifier-20261124/event-i0263-rerun.json --channel orca_bot'
```

输出：

```json
{"key":"lil-bobcn/scratch-bot-sim:#92:补缺口提案:i0263-rerun-1","skipped":false,"results":[{"channel":"orca_bot","ok":true,"ms":435}]}
```

退出码 0。消息进了已有 chat `3ee2d30c-5d14-4b25-ac35-def729852b0e`（标题 `your owner's agent: 补缺口 Lil-BobCN/scratch-bot-sim#92`），From 是 `BOT:400BFE9E-1663-4419-95E8-DE3468335454`，类型 handoff。chat 数量复验前后都是 3，没有新开。结论：第 1 项通过。

## 2. bot 用 token 写评论：通过

手工叫醒 bot（`--type handoff`，消息 `msg_3d769d715cac`，chat `3ee2d30c-5d14-4b25-ac35-def729852b0e`），让它按 SOUL 加载 `~/.afkfactory/env`，在 scratch 仓写评论。

bot 在 chat 里执行的命令：

```bash
set -a; . ~/.afkfactory/env; set +a
gh issue comment 92 --repo Lil-BobCN/scratch-bot-sim \
  --body "I-0263 能力检查：bot 用 GITHUB_TOKEN 写评论成功 2026-11-24 09:58:38 CST"
```

bot 回报：退出码 0，评论链接
https://github.com/Lil-BobCN/scratch-bot-sim/issues/92#issuecomment-7119635087

GitHub 侧核对：作者 `Lil-BobCN`，`createdAt` 2026-11-24T01:58:41Z（09:58:41 CST），正文时间是 09:58:40 CST，对得上。

偏离：用的是 `gh`，不是 `factory/bin/*` 的工厂命令。这里证明的是 bot 进程能加载 token 并写 GitHub；工厂 CLI 本身没有跑。

## 3. 手机收到并回复：通过

运营者确认手机收到，并在 chat 里回复了一句 `手机恢复测试`。这条消息出现在 bot 的回答之后，内容与测试动作一致。

bot 随后回复（2026-11-24 10:01:19 CST）：

```text
手机恢复测试收到，我在线，一切正常。
- 时间：2026-11-24 10:01:19 CST
- `~/.afkfactory/env` 加载成功，`GITHUB_TOKEN` 可用
- `gh api user` 返回 `Lil-BobCN`，退出码 0
```

手机到 bot 的往返成立。

## 4. 模型额度：通过

bot 回报的模型标识：`ccs-claude-deepseek--deepseek-v4-flash[1m]`。

两轮回答都正常，没有 401、403、402，也没有别的报错。`gh api user` 退出码 0。

## 隔离核对

- 主 config：`~/.grilling/notifier/config.json` 没读内容，只取了元数据。mtimeMs `1794812304`、size `347`，和 I-0268 记录的基线 `1794812304809` / `347` 一致。没改。
- 主 launchd 调度器：没重启，没改 plist。
- 主作业表 `~/.afkfactory/jobs.json`、主锁目录：没写。
- 本轮 notifier 只读临时 `NOTIFIER_HOME`。临时 config 只改了 `bot` 名字。
- scratch 仓 #92 多了一条测试评论；Orca 多了一个 chat `3ee2d30c-5d14-4b25-ac35-def729852b0e`。

## 偏离票面的地方

1. 临时 config 的 bot 名从占位符 `afk` 改成 `莹宝（AFK）`。不改的话连 chat 列表都拿不到。
2. 检查用的 notifier 代码来自集成分支 worktree，不是生产 main 的检出。检查时本地 main 已到 `8129572`，代码相同。
3. 第 2、3、4 项是在手工叫醒 bot 之后验的，没有走 notifier 的 `orca_bot` 通道；通道本身在第 1 项已经判定不过。

## 结论

- 四项全部通过。第 1 项在 I-0269 修复后复验通过。
- I-0269（GitHub #627）已关闭，产出决定 D-0394。
- 本票可以关闭；本票关闭后 I-0264 解除阻塞。
- 第 2、3、4 项的证据按原记录；第 1 项的复验见 1.4。
- 同一段流程写在 I-0269 票面、I-0263 评论 C-1379 和 GitHub #621 上。
