# 第 28 集｜Grill vs Wayfinder vs Ship First

> 作者：Matt Pocock（原课程作者）；B站上传：红白RW
> 来源：https://www.bilibili.com/video/BV1K2sf6VEkc?p=28
> 平台：bilibili
> 口播状态：本地 ASR（whisper.cpp small），partial
> 主张状态：视频观点未经独立核验

## 一句话摘要

作者给出一条决策树：改动很小就直接让 agent 做（one-shot）；中等以上先用 `grill with docs`；如果 grilling 中途发现雾太大，再升级成 Wayfinder。反过来从 Wayfinder 起步，代价高得多。

## 阅读路线

先看三个选项分别适合什么，再看作者为什么推荐「默认 grilling，必要时升级」，最后看两个失败方向：小事搞大仪式、大事不做规划。

## 来源与提取记录

- 内容 ID：`BV1K2sf6VEkc_p28`
- 音频时长：`195.221` 秒
- 音频 SHA-256：`94275c65a79302ef61f565f59c6afc2d012ffd7a24e09f320718b5031b8c4366`
- 提取路径：`asr`

## 口播文章

### 三个选项

我们已经看到完整的 Wayfinder 流程：从 grilling 到原型、研究、任务票，再到 spec 和实现。我想你会同意，这是一套相当重的流程。

你自己走的时候会比我快，因为不用一边做一边解释。但仍然有很多 grilling 会话、很多原型、很多思考，才轮到 agent 动手。

所以问题来了：什么时候用 `grill with docs`，什么时候用 Wayfinder？我觉得其实还有第三个选项，我之前没怎么讲：什么时候完全不用 `grill with docs`，直接一次性把代码做出来（one-shot）？

### 决策树：先看改动大小

当然，我有一棵决策树。最上面是：你要开一个新会话，要创建一件新工作，但不知道该选什么。

我的第一个问题是：你要创建的 diff 是不是很小？换句话说，你是在改按钮颜色吗？是在让一个失败的测试通过吗？你要评审的东西是不是真的非常小？如果非常小，你不需要担心和 agent 对不齐。`grill me` 和 `grill with docs` 防的是另一种痛苦：你创建了一个巨大的 diff，结果完全不是你想要的，浪费了大量 token 和时间，做出一个对你毫无价值的东西。但如果 diff 很小，就算做废了也没关系，小到 agent 可以很快重做。

所以很多时候我会直接说：好，你去做，看看做得怎么样，我之后评审。我在 QA 小东西时经常这样，比如改个图标、改段文字，或者这个太大了、边距太宽，UI 上特别多。

这些情况我推荐 one-shot，而且老实说，我用 one-shot 越来越多。但只要 diff 到了中等大小，任何不算小的东西，`grill with docs` 都很好用。

### 默认 grilling，必要时升级

这里有个关键建议：所有你不打算 one-shot 的会话，都从 `grill with docs` 开始。为什么？因为你随时可以从 `grill with docs` 升级到 Wayfinder。

如果你在做 `grill with docs`，然后意识到「哦，我们进入变笨区了，这比我一开始想的大得多」，你可以在会话里直接说：把它变成一张 Wayfinder 地图。这样你的初始决定就很简单，只需要在 `grill with docs` 和 one-shot 之间选。因为反过来的失败情况是：你一开始就用 Wayfinder，做完了所有仪式、建了一张大地图，然后发现其实比你想的简单得多。这很难收场，因为你已经创建了一堆资产。

所以我总是建议从 `grill with docs` 开始。如果你感觉「雾比预期大得多，这看起来很大」，再升级到 Wayfinder。

这就是决策树。你不必对所有东西都做 `grill with docs`，当然也不必对所有东西都用 Wayfinder。你可以比你想象中更多地 one-shot，也可以把 Wayfinder 当成 `grill with docs` 失控时的逃生口。干得好，下一集见。

> **思考一下｜升级比降级便宜**
>
> 从 grilling 升级到 Wayfinder，只是把已有讨论转成地图；从 Wayfinder 降回 grilling，要扔掉已经建好的票和结构。
>
> **可以追问**：升级时，grilling 会话里的哪些内容应该搬进地图，哪些应该丢掉？
>
> **可延展方向**：在 grilling 会话里设一个「雾太大」的检查点，到了就暂停，决定是否升级。

## 综合解读

论点链：小 diff 做废的成本低，直接 one-shot；中等以上需要先和 agent 达成一致，先 grilling；grilling 中发现范围远超预期，升级 Wayfinder；反过来从 Wayfinder 起步，失败成本高。

成立前提：diff 大小可以事先大致判断；grilling 会话可以中途转成地图；团队接受 one-shot 后靠评审兜底。

待核验主张：「95% 的改动可以 one-shot」不是作者说的，这里只说 small diff 适合 one-shot；具体比例取决于项目和风险。作者说 one-shot 用得越来越多，是个人经验。

边界：涉及钱、数据、安全、公开 API 的改动，即使 diff 小也不该 one-shot；grilling 是否「失控」需要判断力，太早升级会过度规划。

可迁移素材：先判断 diff 大小；默认 grilling；需要时升级 Wayfinder；把 Wayfinder 当逃生口，而不是默认入口。
