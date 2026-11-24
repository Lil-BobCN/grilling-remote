# D-0391 锁单点改到点头：执行报告（2026-11-24）

锁单点从 spec issue 创建前移到 `点头：补缺口`。后端按父工单评论判锁，工厂三处加点头前复查，to-spec 发布前后各查一次关口。四套测试全绿。

分支：`issue-lock-at-nod`（从 `d0fcb33`）
提交：

- `bf2e7fc` FACTORY: I-0240 后端按补缺口点头判锁
- `4215712` FACTORY: I-0240 点头前复查和 to-spec 发布守卫
- `92538ab` FACTORY: I-0240 文档和决策记录改到点头锁单

## 改了什么

**后端判锁**

- `backend/lib/protocol.mjs` 新增 `GATE_PREFIXES`、`gateKind`、`latestGate`；`factory/lib/gate.mjs` 改为从后端复用，不再各存一份。
- `backend/lib/spec-lock.mjs`：有父工单号时读父工单评论。最新 `点头：补缺口` 之后没有更晚的 `改口：重传` 就判锁；上传接收时间早于点头评论 `created_at` 的按未锁放行；没有父工单号或没有点头时回退到原来的 spec 标签检查；读 GitHub 失败仍 warning 后放行。
- `backend/lib/uploads.mjs` 传 `parentIssue` 和 `uploadedAt`，锁单文案改成「补缺口已点头」。
- `backend/lib/import.mjs` 的 `isLockedReupload` 传 `order.issue` 和 `meta.at`，兜底文案同步。

**工厂**

- `factory/lib/gap.mjs` 新增 `assertPointGate` 和 `GateConflictError`。`postPoint` 写评论前先读最新关口：同一条点头幂等返回，正文不同、`改口：`、拆票、没有提案都拒绝。
- `factory/lib/small.mjs` 的 `pointSmallRequirement` 在碰实现票之前先查关口，建票后再用完整正文查一次，保证点头不落在旧包上。
- `factory/agents/to-spec.md` 发布前跑 `gh issue view <父工单> --comments`，最新不是 `点头：补缺口` 就不发。
- `factory/agents/console.md` 检查点 1 要求跑 `point` 前重读最新关口。
- `factory/lib/scheduler-jobs.mjs` 的 `createToSpec` 跑完 agent 后重读父工单评论：最新不是 `点头：补缺口` 时，已建 spec 就关闭并在 spec 上写 `作废：已解锁`，返回 `ok:false`，reason 为 `父工单已解锁，本次 spec 作废`；没建 spec 直接失败。路由未改。

**文档和决定**

- `docs/adr/决策记录.md` 新增 D-0391，目录行更新，D-0332 改成「被取代，见 D-0391」。
- D-0186、D-0187、D-0331 正文后加 D-0391 指针；D-0219 不在工作区子集里，只用中台补指针。
- 中台已对 D-0186、D-0187、D-0219、D-0331 跑 `dt decision annotate`，依据写同一句，来源填 D-0391。
- `docs/工单模型.md`、`docs/工厂流程.md`、`docs/客户工作区.md`、`docs/客户进度.md`、`docs/后端服务.md`、`GLOSSARY.md` 的锁单点、改口窗口和 `ready-for-agent` 说法同步。搜过 `to-spec 前`、`to-spec 后`、`锁单`、`spec 已发布`、`运营者贴`，历史归档和研究目录未动。

## 测试

全部实跑，结果如下：

| 命令 | 结果 |
| --- | --- |
| `cd factory && node --test --test-timeout=60000 'test/*.test.mjs'` | 614 项通过，0 失败 |
| `cd backend && npm test` | 192 项通过，0 失败 |
| `python3 -m unittest discover -s 中台/tests -q` | 102 项通过 |
| `bash deploy/test/deploy-selftest.sh` | 65 项通过，0 失败 |
| `python3 scripts/check-decisions.py` | 71 条通过，0 失败 |

新增测试覆盖：

- `backend/test/spec-lock.test.mjs`：点头判锁、`改口：重传` 解锁且不回退、改口后新点头重新判锁、无点头回退 spec、都没有不锁、上传早于点头放行、读评论失败放行。
- `backend/test/reupload.test.mjs`：真实锁单下点头后重传 422（文案 `补缺口已点头`）、写 `改口：重传` 后可上传、导入兜底转 `needs_operator` 且传入 `parentIssue` 和 `uploadedAt`。
- `backend/test/upload.test.mjs`：锁单假函数收到 `parentIssue` 和 `uploadedAt`。
- `factory/test/gap.test.mjs`：无提案、改口后、同一条点头幂等、另一条点头、拆票后五种。
- `factory/test/gap-cli.test.mjs`：命令行 `point` 在改口后拒绝且不写点头。
- `factory/test/small.test.mjs`：小需求改口后拒绝且不建实现票。
- `factory/test/scheduler-jobs.test.mjs`：发布后已解锁时关闭 spec、换新提案时关闭 spec、读评论失败不关 spec、正常路径仍成功；brief 带 `gh issue view` 守卫。

## 偏离

- 小需求也要先有 `提案：补缺口` 才允许点头。原测试直接跑 `pointSmallRequirement`，这次补了提案评论；生产流程本来就是先提案后点头。
- 后端评论分页上限设 10 页（1000 条），spec issue 查询仍是 3 页。超过上限时只用读到的最新关口，没有额外探测。
- `作废：已解锁` 写在 spec issue 上，不是父工单；调度器另会在父工单写 `to-spec 失败：父工单已解锁……`。
- `assertPointGate` 在关口是「另一条点头」时要求先写 `改口：重传` 再等新提案；这是按模板「正文不同：拒绝」实现的，没有提供原地覆盖。

## 未覆盖

- 没有对真实 GitHub 端到端跑过；只在假 GitHub 和现有集成测试里验证。
- 前端客户页和 `factory/lib/console.mjs` 的待办逻辑没改；`toSpecWaiting` 仍是「排队中 + 最新点头 + 没有 spec」。
- 调度器没有重启，不确认线上进程加载的是哪份代码。上线要重启后生效。
- 老单没有点头的走 spec 标签回退，没有做数据迁移。

## 风险

- 判锁多一次 GitHub 评论读取。GitHub 限流或超时会按未锁放行，客户可能上传成功但导入时再兜底拦。
- 上传接收时间和 GitHub 评论时间都取各自时钟；服务器时钟明显快于 GitHub 时，`uploadedAt < created_at` 可能误放行。当前两边都用 UTC ISO，误差在秒级。
- `改口：重传` 是唯一解锁词。运营者写成别的 `改口：…` 不会解锁，得按词写。
