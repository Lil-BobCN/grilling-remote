# I-0269 修复计划：orca_bot 通道从 launchd 发不出去

票：GitHub #627 / 中台 I-0269，父地图 I-0208。
分支 `Lil-BobCN/orca_bot-launchd-chat`，基线本地 main `8129572`（已含 I-0261 的 orca_bot 通道）。
日期：2026-11-24。

一句话：给 notifier 的 orca_bot 通道补发送方身份，再让 chat 标题匹配容忍真机前缀，最后从 launchd 同款环境复跑 I-0263 第 1 项。

## 已确认事实

- launchd 进程没有 `ORCA_TERMINAL_HANDLE`；仓库目录下多个 Orca 终端，CLI 不能唯一推断发送方。
- 不传 `--from` 时报 `Could not determine the calling terminal for this orchestration command`。
- 手工传 `--from bot:b3258c07-6bf2-4df0-a8e7-b4d1334e8009` 能发，退出码 0，消息进 Home Chat（I-0263 记录）。
- 真机 chat 标题是 `your owner's agent: 补缺口 Lil-BobCN/scratch-bot-sim#92`。
- `_find_chat` 精确比较标题，前缀对不上，每次叫醒都 `--chat new`。
- 本机 bot：`莹宝`（私人助理）、`莹宝（AFK）`（工厂传递员）。没有专用通知 bot。
- `orca bot create --offer` 会在运营者 chat 出一张卡片，运营者点「Create bot」才建。

## 步骤

1. [x] 运营者定发送方身份（HITL）：选新开专用通知 bot。`orca bot create` 卡片已出在莹宝的 chat，等点 Create bot。
2. [x] 配置加 `sender`；开启 orca_bot 时缺发送方在加载配置阶段报错。
3. [x] 发送时把 sender 传给 `orca orchestration send --from`。
4. [x] chat 标题匹配容忍 `your owner's agent: ` 前缀；规则收进 `notifier/chat_titles.py`。
5. [x] 发送失败的错误信息脱敏，不把 sender handle 写进日志。
6. [x] 单测：缺发送方、配置发送方、标题前缀、找不到 chat、重复叫醒不新开。111 项通过。
7. [ ] 从 launchd 同款环境用临时 `NOTIFIER_HOME` 复跑 I-0263 第 1 项：退出码 0、莹宝（AFK）chat 收到 handoff、同父工单第二次进同一个 chat。
8. [x] 修复记录写 `.inbox/plans/`；PR #628（基线 `drill4-repair-plan`）；待关票记录 CL-0213（D-0392）。
9. [ ] 关票后回 I-0263 重跑第 1 项（本票之外的流程要求）。

## 边界

- 不改事件表、三个人工点、调度器判断。
- 主 config 不读不改；主 launchd、主作业表、主锁目录不碰。
- 主 config 的 orca_bot 保持关闭，等修复和复验通过、第五次演练前由运营者开。
- 只关本票不代表 I-0263 通过；I-0263 没关之前不开 I-0264。

## 状态

- 2026-11-24：发送方定为新开专用 bot「工厂通知」；代码和单测完成；PR #628 基线 `drill4-repair-plan`，待关票记录 CL-0213（D-0392）。等合并后回 I-0263 重跑第 1 项。
