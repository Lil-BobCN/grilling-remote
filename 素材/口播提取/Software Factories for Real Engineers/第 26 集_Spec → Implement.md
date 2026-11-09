# 第 26 集｜Spec → Implement

> 作者：Matt Pocock（原课程作者）；B站上传：红白RW
> 来源：https://www.bilibili.com/video/BV1K2sf6VEkc?p=26
> 平台：bilibili
> 口播状态：本地 ASR（whisper.cpp small），partial
> 主张状态：视频观点未经独立核验

## 一句话摘要

这一集是练习说明：用 `to-spec` 把完成的 Wayfinder 地图转成 spec，再用 `/to-tickets` 拆票，最后用 `/implement-spec` 实现并提 PR。

## 阅读路线

短集。记住三个命令的顺序：`to-spec` → `/to-tickets` → `/implement-spec`。每一步之间清一次上下文。

## 来源与提取记录

- 内容 ID：`BV1K2sf6VEkc_p26`
- 音频时长：`51.968` 秒
- 音频 SHA-256：`55c980182f993ef92eb98dcf9872035c8444ad0c94581e0ba1606a05b70f276c`
- 提取路径：`asr`

## 口播文章

### 三个命令：地图到 PR

好，Wayfinder 地图完成了，现在要从它创建 spec。做法是跑 `to-spec`，把 Wayfinder 地图传进去。创建 spec 后，我用 `/to-tickets` 从 spec 创建票。票创建好，再清一次上下文，跑 `/implement-spec`。

到这一课结束，我们会有一个已经实现的 spec，会提 PR 到仓库，可以 QA 和检查。希望这些通知第一次就能正常工作。

agent 会读到整张 Wayfinder 地图，会读到 spec，spec 会链接回地图，所有票会链接回地图和它们的原型，等等。我们传给 agent 的上下文会非常详细，它应该能直接做对。祝你好运，解答集见。

> **思考一下｜地图和 spec 的分工**
>
> 地图是索引，spec 是压缩后的执行指令。作者说 spec 把东西「摊平」，让 agent 更容易找到需要的信息。
>
> **可以追问**：如果 spec 和地图冲突，应该以哪个为准？
>
> **可延展方向**：在 spec 顶部写明它由哪张地图生成、地图的哪些决定是权威来源。

## 综合解读

这一集是流程说明，不是论证。可迁移的是：地图、spec、票、实现之间要有可追溯的链接。

成立前提：地图已经完成；`to-spec` 能读地图和决策票；`/to-tickets` 能拆出可执行票；`/implement-spec` 能并行实现。

待核验主张：「第一次就能正常工作」是作者的预期，不是保证；实际结果取决于 spec 质量和代码库状态。

边界：如果地图本身有缺口，spec 会把缺口放大；如果票拆得太细，协调成本会上升。

可迁移素材：三个命令按顺序跑；每步之间清上下文；保留地图、spec、票之间的链接。
