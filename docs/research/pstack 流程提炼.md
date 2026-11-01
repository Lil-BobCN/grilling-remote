# pstack 的流程：两千五百个 PR 一个月怎么来的

> 材料：`docs/research/pstack 作者_每月 2500 个 PR，睡觉时 AI 还在干活.md`。65 分钟英文播客的 ASR 转写，标注 partial。转写没有区分说话人，本文的"他说"按上下文判断，主持人的追问会写明。数字都是他的自述，没有第三方核验。
>
> 引文格式：`（L240｜"段首前几个词…"）`。L 是转写文件的行号，引号里是该段开头的原文，完整段首见最后一节。ASR 分段有时从上一句中间切开，所以部分"段首"看着像半句。英文引文保留原样，错听处用方括号补正常拼写，例如 Send [ascend]。
>
> pstack 在转写里也写成 PSAC、p-sac。文中标"我的判断""推断""建议"的是我补的。分析性章节（多客户、冲突点、小结）整体是我的判断，引文只用来证明他的原话或做法。

## 一句话

他一个月合 2500 个 PR。做法是把"怎么算做完"交给 agent 自己验证，把"别再犯"写进代码库和工具。人退到抽样和改规则的位置。

前提有三个：他所在团队能改代码库的规则，产品跑得起来做验证，改动可以回退。三个前提在多客户场景里都要重新算。

## 信任阶梯的五级

先说清楚：转写里他反复说 trust ladder（信任阶梯），但没有逐级编号。下面五级是我拼出来的。依据是他的时间线：Meta 副业、Cursor 性能工作、技能库、多项目、自动合。再加上厨房比喻。分级本身是推断，每一级的判据和翻车点有原话支撑。

一句话版：每上一级，交出去的是一种判断。先是打字。然后是做法。然后是"做完没有"。然后是"去哪找事实"。最后是"能不能合"。

| 级 | 交出去的判断 | 到了这一级说明 | 厨房对应 | 出处 |
| --- | --- | --- | --- | --- |
| 1 | 无。人就是代理 | 起点。所有判断在人身上 | 一个人做全家饭 | L036 L038 |
| 2 | 做法 | 技能写出来了，人还在看输出对不对 | 有菜谱和刀的厨工 | L042 L096 |
| 3 | 验收 | agent 能自己跑、自己看结果 | 能自己尝味的主厨 | L094 L096 |
| 4 | 找料 | agent 能自己拿到事实，不靠人搬 | 能自己订货的行政主厨 | L176 L178 |
| 5 | 合并 | 验证和环境到位，人敢走开 | 连锁店老板 | L240 L244 |

他没有一张判据检查表。判据是：这件事，agent 能不能自己拿出我本来要的证据。拿得出，就交；拿不出，就还在当代理。这句话是我从他多处说法里归纳的，不是原话。

阶梯还会往下掉。他换工作时把个人技能丢了，觉得不再相关，后来才重新捡起来（L048｜"Personal skills because I didn't think they'd be…"）。这一级不是永久资格。

### 第 1 级：一个人守着灶台

他的起点是累。他会用 AI，但大量时间花在盯着一个 agent 上。

在 Meta 之后休假做副业，花很多小时微调一个 agent（L036｜"You know spending like so many hours just…"）。当时社区迷编排（orchestration），他自己写了一个编排器（L038｜"You know, I built a custom orchestrator, right?And…"）。

技能也在做，但量不出效果。他的原话是"我在盲飞"（L040｜"So I was kind of flying blind, but…"）。

这一级的特征是：agent 只是打字快，所有判断还在人身上。

翻车点：他加入 Cursor 后把个人技能丢了，以为不再相关（L048｜"Personal skills because I didn't think they'd be…"）。这是真实发生的倒退，不是假设。

### 第 2 级：把做法写成技能

技能是他"把自己的能力抽出来给 agent"的入口（L042｜"as I was really interested in this idea…"）。他把日常做法写成 how、why、unslop 这类技能。

但技能不解决信任。他明说：这些技能再好，他还是那个代理，还是要自己看输出（L096｜"That gave me a lot of that was…"）。

所以这一级只交出了"怎么做"，没交出"做得对不对"。

翻车点：技能的影响很难量。他做技能时一直在快速迭代，但没有测量手段（L040｜"So I was kind of flying blind, but…"）。

### 第 3 级：给 agent 眼睛和手

转折点是验证技能。他给 agent 装上手和眼睛：能跑代码、能像用户一样点、能取 trace 和快照（L094｜"Don't know what that means. It's this idea…"）。验证是他加入 Cursor 后做的第一个技能。原话是"started to let me Send [ascend] the trust ladder"。之前那些技能做不到（L096｜"That gave me a lot of that was…"）。

原因在循环：让循环成立的最重要部分是验证（L098｜"There's no way it can actually iterate Right…"）。有了评分标准（rubric），agent 可以反复改。这就是 hill climbing（L100｜"You know that takes you out of the…"）（L102｜"Rubric or a way to judge or score…"）。

判据：agent 能自己回答"这轮做完没有"。人不再当 agent 和 DevTools 之间的"肉代理"（L046｜"Uh, I was doing everything manually. I was…"）。

翻车点：每个 agent 都重新写一遍验证脚本。原话是"每次都把世界重建一遍"。上一轮能用的脚本还留不下来（L120｜"because now the agent doesn't need to Uh,…"）。

他的解法是把确定性步骤做成 CLI，塞进技能里，所有 agent 共用（L122｜"And it doesn't work and the last agent…"）。

### 第 4 级：把外环接进来

他把工作分内外两环。内环是 agent 朝一份意图快照写代码。外环是 Slack、Linear、X、邮件里的真实信号（L170｜"So I like to talk about this outer…"）。

不接外环，人就是摆渡人，把 bug 报告和限制条件一趟趟搬给 agent（L172｜"So, you know, if you if you don't…"）。

他的做法是用连接器订阅频道和邮箱。常用的连接器是 grok bot（转写里也写成 grog bot）。它按 routine 把上下文送进 Cursor 的 project（项目，里面有一个协调 agent）（L192｜"Yeah, so So, uh, this is I guess…"）（L198｜"Or my emails Or linear and they're just…"）。

agent 收到后自己分诊、复现、确认 bug 在 main 上还在（L176｜"Right or you have your own Harness, right…"）（L178｜"So that I have a lot of trust…"）。

他借了 Netflix 管理者的说法：context, not control。给上下文，不靠微观控制（L194｜"Plaid, I don't know like all these different…"）。

判据：agent 能自己拿到事实，不靠猜（L180｜"Um, especially if you are thinking about how…"）。人只定"看什么"。

翻车点：意图快照会过期。新信息进来，人还是得更新快照（L170｜"So I like to talk about this outer…"）。外环接得再顺，方向仍要人给。

### 第 5 级：让 agent 自己合

这是他说的"big unlock"。他先问的是"怎么让 agent 能合自己的代码"，没先问"怎么审 2500 个 PR"（L186｜"And they spawn sub agents to go and…"）。

他提到别人听到 2500 个 PR 的第一反应就是"你怎么审得过来"（L188｜"The obvious thing people ask me when when…"）。

做法是 full autopilot（全自动模式，agent 自己验证并合入）。每个 PR 起一批 verifier（验证 agent）。它们跑应用、fuzz（乱点乱试）、找回归、找 bug。找到问题就自己修，循环到能合（L240｜"um But the idea is like, yeah, I…"）（L242｜"it's going to click around and try to…"）。

然后 agent 自己合。人第二天看 commit history，抽样看 diff。发现问题就 revert、改代码、加 lint（L244｜"Right or you know, just tell the agent…"）（L246｜"All right, and I'll go in revert or…"）。

判据：验证和环境两件事都到位，人敢走开（L244｜"Right or you know, just tell the agent…"）。

他补了一句：这很难，不要以为是装个工具就能做到（L234｜"And when you do that enough times then…"）。

翻车点：第一晚很害怕，怕睡着时把东西弄坏（L246｜"All right, and I'll go in revert or…"）。

他说这需要勇气（L248｜"Uh, and it took a lot of it…"）。

他先说这不算暗工厂，转头又承认 agent 自己合的时候灯确实是暗的（L236｜"failing and thinking very thoughtfully intentionally and Setting…"）。

访谈里用"调光开关"形容这种半自动状态：有些部分仍然是暗的（L250｜"Which is the code almost doesn't exist. You…"）。

## 一条 PR 的生命周期（逐环节）

先给结论：这条链上没有需求评审会，也没有人工拆单。人定的是订阅规则和方向。拆、写、验、合都在 agent 侧。人只在两处出现：给上下文，和事后抽样。

### 链路

```text
外部信号（Slack / Linear / X / 邮件 / 读代码 / 扫坏味道）
  ↓  外环 bot 按 routine 订阅、初筛
协调 agent（Cursor project，云上，有自己的电脑）
  ↓  判断拓扑，拆给 subagent；相关的合成一批
subagent 写代码（环境约束写法）
  ↓
验证技能 / CLI（跑起来、点关键路径、截图、取 trace）
  ↓  full autopilot：verifier 集群 + fuzz，自己修
agent 自己合
  ↓
人第二天看 commit history，抽样看 diff
  ↓  发现问题
revert / 改 / 加 lint，回到环境
```

### 需求怎么来

三类来源。第一类是外部系统里的真实报告：Slack、Linear、X、邮件。连接器订阅，按 routine 转发（L192｜"Yeah, so So, uh, this is I guess…"）（L198｜"Or my emails Or linear and they're just…"）。

第二类是主动扫代码。比如 React 的坏模式多，他专门放一个 agent 一直找（L220｜"Another simple example is, you know, react has…"）。

第三类是读代码和日常维护。他明说 2500 个 PR 不是 2500 个功能。很多没有对应需求，很大一部分是 gardening（把代码库当花园打理）（L212｜"Builds up this sort of and accelerates the…"）。

人不再逐条搬。他给 bot 的原话是：盯着 grok bot 桌面版的 bug。发现就发给我的 Cursor project（L198｜"Or my emails Or linear and they're just…"）。

### 谁拆

协调 agent。它在云上，有自己的电脑，不干具体的活，只管理和分派（L200｜"Again, like a you get a coordinator agent…"）。

突然来 30 个 issue，它一次收下。判断用哪种拓扑，再起一个或多个 subagent（子 agent）（L202｜"managing things and passing context to them So…"）。

相关的问题会被合成一个 project。理由有两个：分开做会重复劳动；多个相似的 bug 放在一起，才看得到更高层的原因（L206｜"Because they're all related, right? Maybe as an…"）（L208｜"You know, sometimes when you you solve bugs,…"）。

人给上下文，或者教 agent 自己取上下文（L184｜"Chain restaurants, right? I can I can really…"）。这里没有人工拆单会。

### 谁写

subagent 写。协调 agent 只派活，不写（L200｜"Again, like a you get a coordinator agent…"）。写法受环境约束：lint（静态检查）、类型、目录约定把可选路径收窄。这部分在下一节展开。

### 队列怎么排

他没有讲优先级队列、SLA（服务时限）、并发上限。

转写里能看到的只有两种排队机制。

第一种是缓冲文档。扫出来的问题先追加到一个文档，不立刻修。隔几天人看一遍，发现"其实都是同一件事"，再一起处理（L220｜"Another simple example is, you know, react has…"）。

他说缓冲的作用是让人在纯执行状态里还能看到大局。慢不是问题（L222｜"sometimes that's actually more effective than Just spawning…"）。

第二种是按相关性分组。相关的 issue 进同一个 project，协调 agent 决定拓扑（L202｜"managing things and passing context to them So…"）（L206｜"Because they're all related, right? Maybe as an…"）。

这段是我的判断：这套队列按相关性排，不按紧急度排。真正紧急的线上事故怎么插队，转写里没有答案。

### 谁审

两道。

机器审。full autopilot 下每个 PR 一批 verifier。它们跑应用、点、fuzz、找回归，自己修（L240｜"um But the idea is like, yeah, I…"）（L242｜"it's going to click around and try to…"）。

verifier 数量可调。可以上到十个，也可以只留一个，成本自己定。

人审。抽样，不逐条。他的原话是大规模下不可能每道菜都尝，只能抽样、看流程（L228｜"But you also, you know for scale you…"）。

他给自己的做法是每天早上看合并记录（L244｜"Right or you know, just tell the agent…"）。

用他的比喻，这像质检员每天进去抽样。重点在 agent 有没有反复走同一个捷径，不在单条对错（L230｜"Every day and you look at the quality…"）。

时点上，他说自己已经变成"PR 落地之后再审"（L240｜"um But the idea is like, yeah, I…"）。早上看 commit history，有问题再动手（L244｜"Right or you know, just tell the agent…"）。

### 谁合

agent 合。full autopilot 是 pstack 里的一个模式，他让 agent 用（L240｜"um But the idea is like, yeah, I…"）。这是他说的两千到两千五百个 PR 的关键一步（L186｜"And they spawn sub agents to go and…"）。

### 失败怎么处理

三层。

合并前，verifier 找到问题，agent 自己修，再验，循环到能合（L242｜"it's going to click around and try to…"）。转写没说循环上限，也没说什么时候放弃。

合并后，人看到问题，revert、改代码、加 lint（L246｜"All right, and I'll go in revert or…"）。

重复失败：如果多个 agent 犯同一个错、走同一个捷径，说明环境有问题。去改厨房，不改那一个 PR（L232｜"But if you actually notice that multiple agents…"）。

他的判断标准是：一次算偶发，多次算环境（L230｜"Every day and you look at the quality…"）。

### 他没讲的部分

- 没有缺陷率、返工率、回滚率。质量证据是"我睡得更好"这类体感（L246｜"All right, and I'll go in revert or…"）。
- 没有单 PR 成本，只说"相当烧 token"（L242｜"it's going to click around and try to…"）。
- 没有说 2500 里功能、维护、重构各占多少（L212｜"Builds up this sort of and accelerates the…"）。
- 没有说验证循环失败几次就放弃。
- 没有说并发上限、优先级、紧急事故。
- 没有出现 worktree、分支策略、rebase、合并冲突这些词。转写是 partial，可能漏了，不能据此说他不做。
- 数字是自述，没有核验。

## 质量兜底的规则

总原则是他那句：让容易做的事变成正确的事（L050｜"Tend to take shortcuts. Uh, they tend to…"）。落地时靠的是把正确路径做成最短路径，让 agent 偷懒也只能落到正确写法上。下面七条能直接变成规则。

### 1. 让错误写法写不出来

每次看到 agent 犯错，除了改这次输出，还要退一步问：能不能让代码库拒绝这种写法。

他的原话是：每次看到错误，就退一步想，怎么把它变成一条 lint 规则。怎么让代码库让这件事不可能（L156｜"And then every time you see a mistake…"）。

他做的框架 dune 带很多限制性 lint，代码库设计成"一件事只有一种做法"（L150｜"It's it's kind of like our internal next…"）。

效果是"很难写出坏代码"（L152｜"at this conventional pattern And the lint rules…"）。

配套的结构约定：一个功能一个目录，注册表自动发现。不要往 god file（什么都往里塞的巨型文件）里追加（L150｜"It's it's kind of like our internal next…"）。

这条来自他早期八个至少一万行的 god file（L154｜"And I'm not going to append to a…"）。

### 2. 规则放进环境，不要堆进 prompt

他的说法是，环境的好处是不给 agent 增加记忆负担。agent 做事时会撞上规则，在正确的时候被挡住（L160｜"In terms of rules in terms of things…"）。原文的大意是：像鹰一样盯着 agent，把它犯的错变成环境里的东西（L158｜"totally makes sense and don't I mean It's…"）。这条对我们直接有用。与其在 AGENTS.md 里写一百条，不如把能自动检查的写成 lint、脚本、类型。

### 3. 确定性的部分做成 CLI

他把技能里的机械步骤抽出来，写成脚本或 CLI，技能只留需要判断的部分（L110｜"The cli work inside of the verification skills…"）（L114｜"or Refactor some code right from one pattern…"）。

理由是 agent 每次都会用不同方式重做，上一轮的成果还留不下来（L120｜"because now the agent doesn't need to Uh,…"）。

迁移是典型例子。用 code mod（批量改代码的脚本）爬 AST（语法树）做机械转换。不要让 agent 每次自由发挥（L126｜"Going from one technology to another especially one…"）。

判断标准很简单：这一步需要思考吗。不需要，就写成代码。

### 4. 每个应用一个验证技能

Cursor（转写里说现在叫 SpaceX AI）里每个应用都有一个验证技能。它是自动维护的，已经成了团队的关键设施（L104｜"A lot of I spent a lot of…"）。落到我们这里，技能里要有能跑的东西：启动、点关键路径、截图、取 trace。不能只有一段"请验证"的文字。

### 5. 合并前的证据必须是"用过"

full autopilot 的 verifier 重点是跑应用、像人一样点、找回归（L242｜"it's going to click around and try to…"）。光跑单测到不了这个程度。

这是他能给信心的部分（L244｜"Right or you know, just tell the agent…"）。

反过来说：如果自动合的条件只是 CI 绿、测试过，他会怀疑。他说 agent 会挑容易的路、走捷径（L048｜"Personal skills because I didn't think they'd be…"）。测试也可以写成同义反复。

主持人提到一个他分享过的建议（L064｜"is about uh, reducing or eliminating Critical tests…"）：砍掉 agent 写的无用测试。主持人用了 tautology（同义反复）这个词。他表示认同，说这类词能把很多意图压进 agent 的推理。

转写在这里含混，"critical tests"可能是别的词。只能确认两人都反感 agent 堆无用测试。

### 6. 人按模式审，不按单条审

用他的比喻，审查像质检员每天看一批 PR。重点在 agent 有没有反复走同一个捷径，不在单条对错（L230｜"Every day and you look at the quality…"）。一次算偶发，多次就改环境（L232｜"But if you actually notice that multiple agents…"）。这条比逐条 review 便宜，也比完全不看安全。

### 7. 技能从 transcript 里长出来

他有个叫 recall 的技能，翻过去的对话记录。它找自己反复介入的地方，把那些干预变成规则或新技能（L272｜"right and you sort of mine for information…"）（L280｜"You know suggest turning them into lit rules…"）。

原话是过去的对话是"上下文的宝库"，因为那是真实发生过的流程（L280）。

技能本身也会变小。去年的技能写满具体命令，现在的模型不需要，删掉命令只留流程（L286｜"Commands, you know, you should use right? I…"）。

技能就是 markdown，就是语言，没有魔法（L274｜"I mean it's just at the end of…"）。

### 这套兜底的边界

- 这套只在能验证的领域成立。他明说，如果工作很难用程序验证，就很难走到自动合那一步（L258｜"extremely It's very hard to verify Programmatically, then…"）。
- 一次性门他没有答案。数据丢失、不可回退的操作，他的回答是"我真的没有答案"（L258）。
- 他没有量化质量。质量证据都是机制描述加个人信心，没有数字。
- 他自己说这很难，不要包装成装个工具就行（L234｜"And when you do that enough times then…"）。

## 米其林厨房 vs 软件工厂

### 他为什么不喜欢"软件工厂"

他先承认这个词是准确的。原话是"not because, you know, it's not accurate"（L072｜"Not because, you know, it's not accurate, but…"）。

他反对的是联想。很多人一想到工厂，就不会想到质量和手艺。做产品的人在乎用户体验（L072）。

他还说这个词会带来负面联想，米其林厨房更有追求感（L074｜"It also I guess maybe conjures up negative,…"）。

所以分歧在词把注意力引到哪里。工厂引向吞吐和工位，厨房引向味道和主厨。工厂这种组织方式，他承认是准确的（L072）。任务描述里容易把这点说重，要按住。

### 厨房隐喻具体改了什么

下面八条里，角色、食材、分工、连锁、试菜是他明说的。"对应到工程""扩张前"这类句子是我的引申。

第一，人的岗位变了。从炒菜的人变成主厨，甚至是厨房的 CEO。要订货、储存、备料、安排时间，不只做菜（L084｜"But you are thinking You're almost like the…"）。对应到工程：人管上下文、环境、优先级，不管每一行代码。人仍然对最终结果负责，名声还挂在这道菜上（L086｜"um, and I think that again it mirrors…"）。

第二，投资对象变了。环境是食材，技能是刀，代码库是厨房布局（L088｜"Are ultimately the new ingredients that go into…"）。扩张前先修厨房，不是先加人。

第三，加人前先改布局。一个人做饭，忽然全家挤进厨房，只会更乱（L080｜"I think most people would get very stressed…"）。多 agent 并行之前，先分区、先定约定。

第四，分工要有理由。他反对为分工而分工，要求整体大于部分之和（L082｜"How do I think about dividing the work…"）。协调 agent 按相关性分组，就是这个意思。

第五，扩张单位是餐厅，不是工位。一个 project 一家餐厅，协调 agent 是行政主厨，人在几家店之间巡视（L164｜"You know thinking about the kitchen and the…"）（L166｜"Uh and like the kitchen is set up…"）。

第六，审查变成试菜。不可能每盘都尝，但要常常进店尝（L228｜"But you also, you know for scale you…"）。抽样，不阻断。

第七，刀是随身带的。技能属于个人，换餐厅也带着走（L274｜"I mean it's just at the end of…"）（L276｜"They carry they bring their knives with them…"）。

第八，允许部分关灯。访谈里的调光开关，说的就是这种半自动状态（L250｜"Which is the code almost doesn't exist. You…"）。

### 和工厂隐喻的实际差别

下面这张表是我的推断。他本人在转写里只说了角色、食材、分工、连锁、试菜这几件事。

| 问题 | 工厂隐喻会怎么做 | 厨房隐喻会怎么做 |
| --- | --- | --- |
| 扩产 | 加产线、加工位 | 先复制一家完整餐厅，包括厨房和主厨 |
| 质量 | 每件终检 | 主厨试味，顾客回头 |
| 人 | 监工 | 主厨，对最终味道负责 |
| 分工 | 按工序切 | 按菜品和工位切，相关性优先 |
| 自动化 | 追求无人 | 追求少人，保留进店尝菜 |

### 他承认的暗面

他确实在睡觉时让 agent 合代码，也承认这算"暗"（L236｜"failing and thinking very thoughtfully intentionally and Setting…"）。第一晚很怕（L246｜"All right, and I'll go in revert or…"）。主持人总结了一句，他没有反对：代码和环境是根本，环境差就出坏结果（L250｜"Which is the code almost doesn't exist. You…"）。

## 多客户场景能搬 / 不能搬

先纠正一个前提。任务里说他是在"一个大代码库"上做的，转写不支持这个细节。能确定的是：这些应用都在他能改规则的范围内，约定、框架、验证技能由他自己或团队定（L104｜"A lot of I spent a lot of…"）。

他有十多个"chief of staff"，各管一块，但那些块都属于他的项目（L238｜"Uh, I have I have the equivalent of…"）。

所以真正的分界是所有权。仓库数量不是关键。

他拥有规则制定权，客户仓的规则要谈。他做的是自己拥有规则权的多个项目，我们做的是多个业主的多个仓。

他自己的多项目经验仍然有用。一个 project 一家餐厅，人在几家店之间巡视（L166｜"Uh and like the kitchen is set up…"）。

这和多客户的结构像，差别在验收人。

### 能搬的

表里"他的做法"一列有出处；"落到一客户一仓"一列是我的推断和建议。

| 机制 | 他的做法 | 落到一客户一仓 |
| --- | --- | --- |
| 每仓一个验证技能 | 每个应用一个，自动维护 L104 | 建仓第一件事：写 verify CLI 和 skill，能启动、点关键路径、截图、收日志。没有这个，不接自动合。 |
| 环境先于功能 | 新人有好环境，第一天就能出活 L214 L216 | 新客户仓的前几个 PR 用来补 lint、目录约定、检查命令，不急着做功能。 |
| 按客户接外环 | Slack、Linear、邮件连接器，routine 订阅 L192 L198 | 一客户一频道、一 project。bot 初筛后送进该仓的协调 agent。 |
| 一客户一个协调 agent | 十多个 chief of staff 各管一块 L238 | 每客户一个 project，带自己的上下文和预算，不跨客户混。 |
| 缓冲文档 | 扫到的问题先记录，隔几天归并 L220 L222 | 每客户一份维护清单，定期合并成一批，避免一报一 PR。 |
| 抽样审查 | 不能每道菜都尝 L228 | 按客户风险分级：低风险抽样，高风险全查。 |
| 事后看 commit | 早上看 commit history L244 | 每天固定时间看前一天的合并记录，找重复模式。 |
| 技能随身 | 厨师带自己的刀 L274 L276 | 验证 CLI、lint 模板、skill 跨客户复用，改一次全部受益。 |

### 不能搬的

"为什么不能照搬"和"我们的替代"两列是我的推断。出处只对应他的做法。

| 前提 | 为什么不能照搬 | 我们的替代 |
| --- | --- | --- |
| 2500 的量 | 大半是 gardening，自己产品的维护。客户合同不为这类活付钱 L212 | 维护单列成客户可见的项，或留内部配额。不拿 PR 数当产能指标。 |
| 改约定的权力 | 他能定 dune 和 lint，客户仓的约定要谈 L150 L152 | 建仓时把规则写进工程约定，改规则走变更。 |
| 深验证 | 他能跑桌面应用、做 fuzz。客户仓常缺凭证、数据、可跑环境 L240 L242 | 先做可跑的 preview（预览环境）和 seed 数据（初始样例数据）。验证不到就不自动合。 |
| 一次性门 | 他自己说没答案 L258 | 保留人工闸门。迁移先做 dry-run 和回滚，把它变成可回退。 |
| 领域知识 | 他说瓶颈是意图表达，专家有优势 L054 L056 | 每客户配一个懂行的人做上下文负责人。不能指望 agent 补领域。 |
| 成本 | 每 PR 可能十个 verifier，很烧 token L242 | 按风险分级。低风险一个 verifier，或只跑检查。 |
| 工具 | Cursor projects 和 grok bot 的具体能力 L200 L204 | 用 issue、PR、CI 复刻，不绑定某家产品。 |
| 并行冲突 | 转写没讲分支、rebase、冲突 | 我们自己的补丁。解完冲突必须复跑验证。 |

一句话：能带走的是刀，带不走的是厨房。技能和验证模板可以跨客户复用，每个客户仓的约定、凭证、可跑环境要重新建。

## 与我们现有设计的冲突点

| 我们的做法 | 他的做法 | 判断 | 冲突 | 出处 |
| --- | --- | --- | --- | --- |
| 一客户一仓 | 一项目一餐厅，多项目并行 | 认同，但会追问每仓有没有厨房 | 低 | L166 L238 |
| 一需求一 issue 一分支一 PR | 一批相关 issue 进一个 project，大量维护 PR 没有需求 | 反对 1:1 | 高 | L212 L206 L220 |
| AI 满足条件自动合 | agent 自己合，条件是真实使用证据 | 认同方向，反对条件定义 | 中高 | L186 L242 |
| 禁区清单挂起等人工 | 按能不能验证、能不能回退判断 | 方向一致，判据不同 | 低 | L254 L258 |
| rebase + agent 解冲突 | 转写未提 | 没有证据 | 未知 | 无 |
| 两次失败升级 | 修到能合，重复失败改环境 | 反对当主机制 | 中 | L242 L232 L180 |

### 1. 一客户一仓：不冲突

按他的隐喻，这相当于一家餐厅一个厨房。隔离是对的，客户之间不互相污染。

他会追问配套：这个仓有没有验证技能、有没有约定、有没有一个协调 agent。没有的话，就是开了店没厨房。

建议：把"建仓"的定义从"建 git repo"改成"建可验证的厨房"。这一条和我们的做法不打架，只是加了一个完工标准。

### 2. 一需求一 issue 一分支一 PR：冲突最大

他会反对 1:1。三条理由都在转写里。第一，2500 个 PR 不是 2500 个需求，大量是 gardening，没有对应需求（L212｜"Builds up this sort of and accelerates the…"）。

第二，相关的 issue 要合成一个 project 一起做。分开做会重复劳动，也看不到共同根因（L206｜"Because they're all related, right? Maybe as an…"）（L208｜"You know, sometimes when you you solve bugs,…"）。

第三，一个任务一个 agent 会丢线索，重复工作（L206｜"Because they're all related, right? Maybe as an…"）。

他还有缓冲文档：扫到的问题先不修，攒几天归并（L220｜"Another simple example is, you know, react has…"）。1:1 的规矩会让这种归并做不了。

我的判断：这条是我们的记账规则，跟质量无关。它让客户对账方便，但把 agent 的批量能力砍掉了。

建议：issue 继续做验收和计费单位，分支和 PR 的数量解耦。允许三种形态。一个 PR 关多个 issue。一个 issue 出多个 PR。一类维护工作用一个"维护 issue"装一批小 PR。PR 里用表格列清关了哪些 issue。

### 3. 满足条件自动合：方向对，条件会被打

他同意的部分：agent 应该能合自己的代码，这是规模化的关键（L186｜"And they spawn sub agents to go and…"）。他也确实在睡觉时让 agent 合（L236｜"failing and thinking very thoughtfully intentionally and Setting…"）。所以"自动合"本身不是冲突。

他会挑的部分：条件是谁定的。他说 agent 会挑容易的路、走捷径（L048｜"Personal skills because I didn't think they'd be…"）。

如果条件是 CI 绿、测试过，agent 有动机把测试写成同义反复。

他的条件是"跑过"：verifier 起应用、点、fuzz、找回归，自己修到能合（L240｜"um But the idea is like, yeah, I…"）（L242｜"it's going to click around and try to…"）。

建议：自动合的条件分两层。第一层是确定性检查，类型、lint、单测。第二层是使用证据，preview 起来、关键路径点过、截图和 trace 留下。两层都过才合。只有第一层不够。

再补一个他没说但必要的：合并后抽样，加回滚演练。

### 4. 禁区清单：方向一致，判据要换

他区分双向门和一次性门。能合了再回退的是双向门。会造成数据丢失、难以回退的是一次性门（L254｜"um Maybe there are folks working in like…"）。

他的判断落在验证质量上：验证够强，一次性门在某种意义上也能变双向门（L256｜"Like is this something you just wouldn't recommend…"）；验证不了，就别想自动合（L258｜"extremely It's very hard to verify Programmatically, then…"）。

凭证、删数据、大版本依赖，大多是一次性门。按他的判据，这些该挂起。

迁移不一定。他做迁移靠 code mod 和 AST 做机械转换（L126｜"Going from one technology to another especially one…"）。加上 dry-run（空跑）、备份、回滚，迁移可以从一次性门变成双向门。

建议：禁区清单保留为默认例子，真正的判据写成两个问题。agent 能不能端到端验证。出问题能不能在 X 分钟内回退。两个里有一个否，就挂起。

### 5. rebase + agent 解冲突：转写里没有

我查了全文。worktree、branch、rebase、conflict 这些词一次都没出现。中文分别是工作树、分支、变基、冲突。转写又是 partial，可能漏了。不能拿他给这条背书，也不能说他反对。

能推断的只有一点：他的并行靠按领域分 project，冲突在结构上就少。我们是在同一个仓里多分支并行，这是另一种策略。

风险：agent 把冲突解成语法正确、语义错误。他的原则会要求解完冲突重新跑验证，不能只跑测试。

这条是我们自己要补的。

### 6. 两次失败升级：他会反对当主机制

转写里没有"失败两次就交人"的规则。他的循环是修到能合，没说上限（L242｜"it's going to click around and try to…"）。

合并后出问题，动作是 revert、改、加 lint（L246｜"All right, and I'll go in revert or…"）。

同一个错反复出现，动作是改环境（L232｜"But if you actually notice that multiple agents…"）。

他会说：把"升级到人"当默认，人又变成瓶颈（L180｜"Um, especially if you are thinking about how…"）。

但他也要人。他每天早上看合并记录（L244｜"Right or you know, just tell the agent…"）。一次性门他没有答案，所以实际还得人兜（L258｜"extremely It's very hard to verify Programmatically, then…"）。

建议：两次失败先触发一次环境诊断。问什么规则能防住这类错。有规则就加规则再重跑；没有规则，或涉及一次性门，才升级人。升级的对象从"这个 PR"改成"这类 PR"。

成本上说句公道话。他的 full autopilot 很贵，一个 PR 可能十个 verifier。我们的两次上限便宜得多。这是成本取舍，没有对错。

### 另外两条他会追问的

第一，我们的 PR 来源只有需求。他的来源还有主动扫代码和外部信号（L220｜"Another simple example is, you know, react has…"）。少这两个，环境里的坏模式会一直躺着。

第二，我们没有协调 agent 这个层。他要问：谁决定这几个 issue 该不该合在一起做。如果答案是人，人又成了拆单瓶颈。

### 小结

我们的设计整体比他保守。保守在一次性门和失败上限，僵化在需求映射。他反对最硬的有三处。需求必须 1:1 落到 PR。把"条件"等同于检查项。把"升级到人"当默认。

最不该抄的一条，是把"先合再抽样"当默认。他敢这么做，是因为产品归他、改动能回退、验证能跑起来。客户仓的生产数据和验收责任不在我们手上，这三条经常不成立。

低风险、可回退的仓可以抽样。高风险、一次性门的仓，证据要放在合并前。

最值得补的一条，是我们那六条里完全没有的：每仓一个能跑的验证技能。他的整条链都建在这上面。

## 引用段落索引

按行号查原文。段首保留 ASR 原样，不做润色。同一行在多个章节用到时，章节列会列全。

| 行号 | 段首（原文） | 引用章节 |
| --- | --- | --- |
| L036 | You know spending like so many hours just micro managing one agent Right and you know at the time this was back in February. | 信任阶梯的五级 |
| L038 | You know, I built a custom orchestrator, right?And so of course I had I was a bit nerd sniped by that And you know as I… | 信任阶梯的五级 |
| L040 | So I was kind of flying blind, but I was you know iterating really fast um and um So that project eventually sort of became the… | 信任阶梯的五级 |
| L042 | as I was really interested in this idea of how do I You know extract my own Ability if that makes sense and give it to… | 信任阶梯的五级 |
| L046 | Uh, I was doing everything manually. | 信任阶梯的五级 |
| L048 | Personal skills because I didn't think they'd be relevant anymore. | 信任阶梯的五级、质量兜底的规则、与我们现有设计的冲突点 |
| L050 | Tend to take shortcuts. | 质量兜底的规则 |
| L054 | You know as the models get really really really good It almost becomes like the bottleneck is no longer the agent, right? | 多客户场景能搬 / 不能搬 |
| L056 | Techno curious, you know, so I think of people like, you know, like, uh, like a doctor or a lawyer or You know someone who who… | 多客户场景能搬 / 不能搬 |
| L064 | is about uh, reducing or eliminating Critical tests like one of my pet peeves of agents is like all of the useless tests that they write… | 质量兜底的规则 |
| L072 | Not because, you know, it's not accurate, but I think I think the a lot of people when they think factory, right?they don't necessarily create that… | 米其林厨房 vs 软件工厂 |
| L074 | It also I guess maybe conjures up negative, you know, maybe sometimes negative connotations So Michelin kitchen is the thing that I've sort of landed on… | 米其林厨房 vs 软件工厂 |
| L080 | I think most people would get very stressed by that right the thought of so many people are just mucking around in my kitchen They have… | 米其林厨房 vs 软件工厂 |
| L082 | How do I think about dividing the work in a way that makes sense?You know, I'm not dividing work just for the sake of it But… | 米其林厨房 vs 软件工厂 |
| L084 | But you are thinking You're almost like the tech lead right for the kitchen Where uh, you know chefs have to think about you know, not… | 米其林厨房 vs 软件工厂 |
| L086 | um, and I think that again it mirrors so much of How engineers write code today where you are not writing the code yourself anymore. | 米其林厨房 vs 软件工厂 |
| L088 | Are ultimately the new ingredients that go into um building product Yeah, I think what I love about your approach is the amount of focus that… | 米其林厨房 vs 软件工厂 |
| L094 | Don't know what that means. | 信任阶梯的五级 |
| L096 | That gave me a lot of that was that was the thing that actually started to let me Send the trust ladder a little bit in… | 信任阶梯的五级 |
| L098 | There's no way it can actually iterate Right and so this is where people start to talk about loops this idea of a loop And really… | 信任阶梯的五级 |
| L100 | You know that takes you out of the equation where now I can actually do something like So the very one of the very first use… | 信任阶梯的五级 |
| L102 | Rubric or a way to judge or score something And now because you have a loop you can have an agent continually try to make improvements… | 信任阶梯的五级 |
| L104 | A lot of I spent a lot of time actually, you know, tuning the verification the creative verification skill And also internally the the we have… | 质量兜底的规则、多客户场景能搬 / 不能搬 |
| L110 | The cli work inside of the verification skills I guess now it's less so about context because uh, you know agents are Much better or harnesses… | 质量兜底的规则 |
| L114 | or Refactor some code right from one pattern to another. | 质量兜底的规则 |
| L120 | because now the agent doesn't need to Uh, you know reinvent things because one thing I had noticed early on when we didn't have a cli… | 信任阶梯的五级、质量兜底的规则 |
| L122 | And it doesn't work and the last agent did it and it worked but I discarded it So it was just very obvious at that point. | 信任阶梯的五级 |
| L126 | Going from one technology to another especially one that is better for our agents, right?And a lot of how you can do that migration is I… | 质量兜底的规则、与我们现有设计的冲突点 |
| L150 | It's it's kind of like our internal next j s for our electron apps But it comes with a lot of really really restrictive lit rules… | 质量兜底的规则、多客户场景能搬 / 不能搬 |
| L152 | at this conventional pattern And the lint rules make for an environment where it's actually very hard to write bad code And that sort of frees… | 质量兜底的规则、多客户场景能搬 / 不能搬 |
| L154 | And I'm not going to append to a god file, right?that was really actually the inspiration for those feature directories is The very first couple of… | 质量兜底的规则 |
| L156 | And then every time you see a mistake every time you see something that could be done better You think you step back and think how… | 质量兜底的规则 |
| L158 | totally makes sense and don't I mean It's funny that you mentioned typescript and god files in the same sentence because typescript famously has a 25,000… | 质量兜底的规则 |
| L160 | In terms of rules in terms of things it has to remember It's just in the environment and so it stumbles into the rules and exactly… | 质量兜底的规则 |
| L164 | You know thinking about the kitchen and the knives and the tools for my agents and so In a way, I think of this as I've… | 米其林厨房 vs 软件工厂 |
| L166 | Uh and like the kitchen is set up really well. | 米其林厨房 vs 软件工厂、多客户场景能搬 / 不能搬、与我们现有设计的冲突点 |
| L170 | So I like to talk about this outer loop and the inner loop Uh, I don't know if I'm using the definition correctly, but to me… | 信任阶梯的五级 |
| L172 | So, you know, if you if you don't have these triggers pulling information back into the inner loop Then you sort of have to play that… | 信任阶梯的五级 |
| L176 | Right or you have your own Harness, right that you've built a slack subscription into for a particular slack channel Now all of a sudden you… | 信任阶梯的五级 |
| L178 | So that I have a lot of trust right I have a lot of trust that these agents can actually go off and Understand the bug,… | 信任阶梯的五级 |
| L180 | Um, especially if you are thinking about how to scale yourself So a big theme here is really just like always thinking about like What where… | 信任阶梯的五级、与我们现有设计的冲突点 |
| L184 | Chain restaurants, right? | 一条 PR 的生命周期 |
| L186 | And they spawn sub agents to go and do them and so I'm just constantly Feeding context or teaching the agents how to get their own… | 信任阶梯的五级、一条 PR 的生命周期、与我们现有设计的冲突点 |
| L188 | The obvious thing people ask me when when they when I tell them oh, I shipped 2000 and 2500 full requests last month They'll be like,… | 信任阶梯的五级 |
| L192 | Yeah, so So, uh, this is I guess somewhat confusing but we're working on you know simplifying and unifying but so There's grok bot Which or… | 信任阶梯的五级、一条 PR 的生命周期、多客户场景能搬 / 不能搬 |
| L194 | Plaid, I don't know like all these different services and they are a great source of pulling context in to your work So the same way… | 信任阶梯的五级 |
| L198 | Or my emails Or linear and they're just constantly they have routines that subscribe So they're constantly watching and I have I'll tell them things like,… | 信任阶梯的五级、一条 PR 的生命周期、多客户场景能搬 / 不能搬 |
| L200 | Again, like a you get a coordinator agent that's in the cloud It has its own computer and all it really does is like it's a… | 一条 PR 的生命周期、多客户场景能搬 / 不能搬 |
| L202 | managing things and passing context to them So if you get a sudden burst of issues, let's say you get 30 issues at once in one… | 一条 PR 的生命周期 |
| L204 | uh, you know efficiently distribute the tasks to your team of agents um So I use cursor projects a lot and I also use grok bot… | 多客户场景能搬 / 不能搬 |
| L206 | Because they're all related, right? | 一条 PR 的生命周期、与我们现有设计的冲突点 |
| L208 | You know, sometimes when you you solve bugs, you know, it helps to have multiple bug reports that are are slightly different Because it helps you… | 一条 PR 的生命周期、与我们现有设计的冲突点 |
| L212 | Builds up this sort of and accelerates the factory sort of adds more orders in Other than bug reports, are there any other sources that you… | 一条 PR 的生命周期、多客户场景能搬 / 不能搬、与我们现有设计的冲突点 |
| L214 | gardening like another term that I really love where So I guess this is more important when you have a big team of engineers human engineers… | 多客户场景能搬 / 不能搬 |
| L216 | And if you have a really good environment, they can be productive from day one, right?They can they don't have to like, you know, make open… | 多客户场景能搬 / 不能搬 |
| L220 | Another simple example is, you know, react has a lot of foot guns so As I'm sure you're aware and so I have an agent that's… | 一条 PR 的生命周期、多客户场景能搬 / 不能搬、与我们现有设计的冲突点 |
| L222 | sometimes that's actually more effective than Just spawning off a couple like a lot of sub agents to fix every single thing because when you are… | 一条 PR 的生命周期、多客户场景能搬 / 不能搬 |
| L228 | But you also, you know for scale you cannot be tasting every single dish that comes out of your kitchen Especially if you have multiple restaurants,… | 一条 PR 的生命周期、米其林厨房 vs 软件工厂、多客户场景能搬 / 不能搬 |
| L230 | Every day and you look at the quality of the pull requests you look at the code that the agents are writing and you scrutinize it… | 一条 PR 的生命周期、质量兜底的规则 |
| L232 | But if you actually notice that multiple agents are are having the same issue right there taking the same shortcut They're they're propagating the same work… | 一条 PR 的生命周期、质量兜底的规则、与我们现有设计的冲突点 |
| L234 | And when you do that enough times then you get to a place where the code basis again like the environment is So constrained and so… | 信任阶梯的五级、质量兜底的规则 |
| L236 | failing and thinking very thoughtfully intentionally and Setting up guardrails and constraints so that they Do the right thing by default and you're not Like if… | 信任阶梯的五级、米其林厨房 vs 软件工厂、与我们现有设计的冲突点 |
| L238 | Uh, I have I have the equivalent of like more than 10 chiefs of staff, right each working on a different area like For example, I… | 多客户场景能搬 / 不能搬、与我们现有设计的冲突点 |
| L240 | um But the idea is like, yeah, I uh, I when you spend the time setting up your environment I've gotten to a point where I… | 信任阶梯的五级、一条 PR 的生命周期、多客户场景能搬 / 不能搬、与我们现有设计的冲突点 |
| L242 | it's going to click around and try to use it like a real human look for regression look for bugs in your implementation and Um, it… | 信任阶梯的五级、一条 PR 的生命周期、质量兜底的规则、多客户场景能搬 / 不能搬、与我们现有设计的冲突点 |
| L244 | Right or you know, just tell the agent to verify it's on work But yeah, the key thing is the verification part is really the key… | 信任阶梯的五级、一条 PR 的生命周期、质量兜底的规则、多客户场景能搬 / 不能搬、与我们现有设计的冲突点 |
| L246 | All right, and I'll go in revert or modify add new lit rules and whatever um So it does it does take time to get to… | 信任阶梯的五级、一条 PR 的生命周期、米其林厨房 vs 软件工厂、与我们现有设计的冲突点 |
| L248 | Uh, and it took a lot of it took a lot of Bravery I think to do that but somehow I did it and now I'm… | 信任阶梯的五级 |
| L250 | Which is the code almost doesn't exist. | 信任阶梯的五级、米其林厨房 vs 软件工厂 |
| L254 | um Maybe there are folks working in like um medical applications or law or finance or something I think if they're like some prs are kind… | 与我们现有设计的冲突点 |
| L256 | Like is this something you just wouldn't recommend or like what do you think?Yeah, I think that's a really good question. | 与我们现有设计的冲突点 |
| L258 | extremely It's very hard to verify Programmatically, then I think yeah, you're definitely in a position where it's very hard to get to that point um… | 质量兜底的规则、多客户场景能搬 / 不能搬、与我们现有设计的冲突点 |
| L272 | right and you sort of mine for information of you know your own Look through your own your own prompts right to the agents where you… | 质量兜底的规则 |
| L274 | I mean it's just at the end of the day skill is just English or or language. | 质量兜底的规则、米其林厨房 vs 软件工厂、多客户场景能搬 / 不能搬 |
| L276 | They carry they bring their knives with them the tools go with them right and so trust to me is really about trust in your own… | 米其林厨房 vs 软件工厂、多客户场景能搬 / 不能搬 |
| L280 | You know suggest turning them into lit rules or new skills, right?the the past chance I often say is like a a treasure trove of context… | 质量兜底的规则 |
| L286 | Commands, you know, you should use right? | 质量兜底的规则 |
