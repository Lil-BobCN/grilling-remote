# 第三次首单全链演练（#471）

## 已完成
- [x] 读交接、演练记录 17.19、修复批次报告
- [x] 环境检查：main、中台 pid 56703、Docker、Chrome、gh、SSH 全通
- [x] 调度器重启并固定 deepseek-flash；token 已加 workflow scope
- [x] 上传 → 建仓 `demo-tanxin-yuyue` → 父工单 #1 → 地图 #2 → 补缺口点头 → to-spec #7 → 拆票 #8–#13
- [x] 6 张子票全部实现、验证、评审、合并进 `req/o-0006`（PR #14–#19）
- [x] 收尾 PR #20、#21 已合 main
- [x] 现场记录 `$TMPDIR/afk-handoff/drill-third-working.md`
- [x] 问题记录 `$TMPDIR/afk-handoff/drill-third-findings.md`（18 条，第 19、20 条待记录员补）
- [x] 交接文档 `$TMPDIR/afk-handoff/handoff-drill3-finish-2026-11-20.md`

## 待办
- [ ] 运营者补产品 env 三键并重部署（`ADMIN_PATH`、`ADMIN_PASSPHRASE`、`SESSION_SECRET`）
- [ ] 客户地址试用：https://demo-tanxin-yuyue.afkfactory.space/（当前 502）
- [ ] 更新 `docs/research/首单全链演练记录.md` 17.20
- [ ] 给运营者最终报告
- [ ] 发现问题分流修模板/流程（第 14、16、17、18、19、20 条等）

## 现场
- 调度器 pid 68960；stdout `~/.afkfactory/logs/drill-third.log`；轮次 `~/.afkfactory/logs/drill-third-runs.jsonl`
- 中台 pid 56703；客户仓 `Lil-BobCN/demo-tanxin-yuyue` 父工单 #1
- 预览未接（#469/#529），默认不写预览行
