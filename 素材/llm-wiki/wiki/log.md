# Research Log

## 2026-11-03

- 建库：把 `素材/口播提取/` 下 7 份口播稿复制到 `raw/sources/口播提取/`。
- 生成 25 个页面：7 个来源页、10 个概念页、4 个实体页、1 个比较页、1 个综述页、1 个问题页、1 个总览页。
- 证据口径：全部来源为本地 ASR，`partial`；讲者数字和产品主张标为自述。
- 未导入：没有运行自动摄入，没有调用模型生成新页面。

## 2026-11-03 追加

- 新增来源 S8：`一个月上线 2000 个 PR：Lauren 的 AI 团队工作流`，中文配音转写，英文原声核对。
- 新增实体页 Dune。
- 更新验证与自证、环境与约束、信任阶梯、术语表、待确认与冲突、总览、索引和综述。
- S8 的核心增量：Control Glass 的 CLI 加功能地图、五层约束、Dune 的模块边界、注释禁令、园丁角色、GrokBot 外部循环。

## 2026-11-03 整理

- 目录页补记三页：概念页 grilling 的提问规则，综合页 pstack 新视频对接单流程的启示，问题页接单流程与口播的冲突。
- 这三页是流程审阅时新写的，之前没进目录页，也没写进日志。
- queries 下另有 research- 开头的自动生成页，没进目录页，没有逐页核对内容。
- 问题页里指向 docs/流程 v3.md 的路径，改成 docs/archive/流程 v3.md。v3 已归档，只作底稿。
- 没删任何页面。wiki 还用不用，等运营者定。

## 2026-11-09

- 新增来源 S9：`Software Factories for Real Engineers`，38 集，总时长 10,704.8 秒。原文放在 `素材/口播提取/Software Factories for Real Engineers/`，副本放在 `raw/sources/口播提取/Software Factories for Real Engineers/`，共 39 个文件（38 集正文加 1 份系列索引）。
- 新建 1 个来源页：`sources/software-factories-for-real-engineers.md`。38 集用一个来源页加一张集数表承载，没有拆成 38 个来源页。
- 新建 4 个概念页：领域语言与决策记录、Wayfinder 地图与决策票、保真度与原型、软件工厂。
- 新建 1 个实体页：Wayfinder。填写了 `review.json` 里一直缺的 wayfinder 页，但没有改 `review.json` 本身。
- 新建 1 个综述页：软件工厂课程综览。
- 更新：评审与验收、术语表、技能与流程、任务拆分与上下文、grilling 的提问规则、Matt Pocock Skills、pstack 与 Matt Pocock Skills 的分工、待确认与冲突、索引、总览、purpose。
- 证据口径：S9 是英文 ASR 后翻译整理，`partial`。听写疑点有 7 处，集中在第 1、3、19、27、32、36 集，已写进待确认与冲突第七节。
- 版本差异：课程里的 `wayfinder map` / `Wayfinder grilling` 标签，和本机 1.3.1 技能文件的 `wayfinder:map` / `wayfinder:<type>` 不一致，已记录，暂不合并结论。
- 没有运行应用自动摄入，没有改 `review.json` 和 `lint.json`。
