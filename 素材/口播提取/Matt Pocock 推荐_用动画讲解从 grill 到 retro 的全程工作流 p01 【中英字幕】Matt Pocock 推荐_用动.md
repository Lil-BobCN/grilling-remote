# Matt Pocock 推荐_用动画讲解从 grill 到 retro 的全程工作流 p01 【中英字幕】Matt Pocock 推荐_用动

> 作者：Kevin Araujo（The Hype Kevin），B 站转载：ChHsich
> 来源：https://www.bilibili.com/video/BV14Upq6yEq7
> 平台：bilibili
> 口播状态：本地 ASR（英文原声），partial；正文保留英文，编辑层为中文
> 主张状态：视频观点未经独立核验

## 一句话摘要

9 分钟动画，把 Matt Pocock 的 skill 链讲了一遍。grill 把计划里的隐藏决策问出来，to-spec 写成目的地。to-tickets 按上下文预算切片，implement 逐票跑。/pr 四栏降评审成本，retro 回读会话改环境。

## 阅读路线

先看 grill 和 to-tickets 两节，前者决定 spec 的质量，后者决定并行能不能跑起来。再看 /pr 和 retro 两节，那是两个可以直接抄的模板。最后看「两个反驳」，那里有对瀑布式和过度防御的回应。

## 来源与提取记录

- 内容 ID：`BV14Upq6yEq7_p1`
- 音频时长：`544.856` 秒
- 音频 SHA-256：`6dc5c4a633617563a53e037d900e2ef17cbf9bf5c5d13d51c6f723f7010579f2`
- 提取路径：`asr`
- 说明：原始转写没有记录片段数和末段覆盖差。正文保留英文原样，只加小标题和书签，没有改写。

## 口播文章

### 一杯咖啡的功夫，功能就做完了

your agent can build a whole feature while you make a coffee so what are you there for?notpokok has an answer he teaches developers for a living he made total typescript and his answer is a folder of agent skills with more stars on github than react on october 4th he shipped version 1.3 say you run a coffee subscription app and you type let users pause their subscription 10 minutes later there's a pause button the tests pass and it works

then a customer pauses on the 29th and still gets a bag of coffee on the first because it was already roasted and packed somebody had to decide what happens to that bag your agent decided it also decided whether the bill stops today or at the end of the month how long a pause can last and what the reminder email says you wrote one sentence so it filled every gap with a guess and kept going agents are polite like that

### 需求里没写的决定，agent 会替你猜

couldn't you write a longer prompt you'd only write down the decisions you thought of and the packed bag wasn't one of them mat turns the conversation around before any code exists the agent interviews you and his skill for it is called grill me a relentless interview about your plan picture the feature as a tree of decisions in the fog pause sits at the top under it hang billing the packed bag and how long a pause lasts

### grill：让 agent 反过来面试你

and each of those has more decisions hanging off it the grilling skill maps that tree finds every decision whose parent is already settled called the frontier and asks you all of them in one numbered round each question comes with the agent's recommended answer so a lot of the time you type yes yes no end of the month your answers settle a layer a new frontier lights up and the fog moves back facts are the agent's job

if the answer is somewhere in the code it sends a helper agent to go and read it decisions are yours and it can't start on the code until the frontier is empty and you agree you're on the same page on a small change mat gets about six questions and around 20 on a normal one while filming a lesson for his course it once asked him 46 his post about it dude chill you're scaring the noobs halfway through you mentioned customers can skip a month

> **思考一下｜事实让 agent 查，决策让人答**
>
> 这段把问题分成两类。能在代码里找到答案的，派 helper agent 去读；需要取舍的，只能人答。
>
> **可以追问**：你的需求文档里，哪些条目其实是 agent 自己能查到的？
>
> **可延展方向**：把「先查后问」写进澄清流程，减少无谓的来回。

### 词汇表：pause 和 skip 不是一回事

the agent stops you is skip the same thing as pause this version is called grill with docks and it keeps a glossary in your repo while it grills pause gets one line no deliveries and no charges until the resume date skip gets another one delivery missed billing carries on under each the words to avoid like hold and freeze an agent dropped into a project has to guess its jargon so it uses 20 words where one would do mat once read out a real reply

from opus 5 that ended it is genuinely load bearing though so that's how you know it matters then he asked the obvious question what does that mean so there's a skill for that moment too type wait what and the agent pitches its last message again in plain english using the words from your glossary some questions won't settle by talking like what the pause screen should look like for those ungrillable ones the agent hands off to a fresh session

### 问不出来的，用原型问

builds a throw away prototype with a few screens that look nothing alike and you click through them and pick then the answer comes back to the grilling when the fog is gone you stay in the same chat and type to spec no more questions this time the agent writes up everything you settled the problem, the fix and a long numbered list of user stories as a customer who pauses after my bag is packed I still get that bag and my pause starts after it

### to-spec：把谈定的写成目的地

first though it agrees the seams with you the places where the tests will poke at the feature and the ideal number of seams is 1 for us that's the billing module the spec goes up as an issue in your tracker labeled "ready for agent"the spec is the destination the tickets are the journey why tickets?because an agent gets worse the more it's holding somewhere past 150,000 tokens it stops reasoning as sharply and the part before that is the smart zone

### to-tickets：为什么一定要切

a term Matt says he stole from Dex Horthy so to tickets cuts the spec into slices that each fit one fresh session each slice runs through every layer database to button so it works on its own ticket 1 pausing stops the next charge ticket 2 a resume date ticket 3 the packed bag ticket 4 the emails 3 and 4 can't start until 1 is done the rule of thumb guess the tokens a job needs and divide by 150,000 so a million token refactor

> **思考一下｜按上下文预算切票**
>
> 切片单位是会话，不是模块。15 万 token 是经验阈值，不是硬指标。
>
> **可以追问**：你们的 ticket 平均要跑几个上下文窗口？
>
> **可延展方向**：把 token 预算写进任务模板，像估工时一样估上下文。

### implement：每个 ticket 一个干净会话

becomes 7 tickets then the build type implement on ticket 1 clear the chat implement ticket 2 so every ticket starts in a clean head or use implement spec new in 1.3 which builds the whole spec in one go one agent per ready ticket each in its own copy of the repo all landing on one branch either way it works test first a failing test at the agreed seam then only enough code to pass it one slice at a time the skill used to have a refactoring step 2

### 评审换一张桌子

Matt dropped it because the agent never ever ever did it refactoring move to review and review happens at a different desk an agent that has written some code thinks it's fine because it wrote it so code review hands the diff to two fresh agents one reads it against the spec looking for anything missing anything nobody asked for and anything that looks done but is wrong the other reads it against your coding standards and a dozen classic

code smells from martin fowler's refactoring the agent that wrote the code never saw those standards models are bad at following a list of don'ts while they build and a reviewer hunting for exactly those problems has nothing else on its mind on ticket 3 the spec reviewer quotes our user story back pausing today cancels the packed bag when the fix goes up as a pull request a skill called PR writes the description it's adapted from Dex Horthy's

### /pr：四栏让人愿意看

show me skill the smallest picture that explains the change proof from before and after and a section called merge danger is this a one-way door or a two-way door and how big is the blast radius ours adds a column to the subscriptions table two-way door blast radius billing the last step is the other big one in 1.3 before you clear the chat type retro the agent reads back through the session it just had and suggests changes

### retro：回读会话，找出看不见的浪费

to its surroundings the repo the checks the instructions that matters because your agent won't complain it bumps into problems keeps pushing until the feature worksand the struggle stays buried in the transcript here it spentten minutes hunting for the billing code so it suggests one line in your agent instructions that points at it it called the payment provider directly twice which your code base never does so that becomes a lint rule

a mistake a machine can spot gets a check full stop and the written coding standards keep only the judgment calls found an error do a retro and make it impossible next time people keep asking matt to put retroon autopilot and he says don't because an agent fixing its own findings ends up chasing false positives it only suggests and you pick which fixes to keep a coffee app is a toy so take something real on september 25th

> **思考一下｜把摩擦写成检查**
>
> 找代码花十分钟，就加一行指路；直接调支付商两次，就加 lint。能机器抓的，别留给人记。
>
> **可以追问**：你的 agent 这周在哪件事上重复摸索？
>
> **可延展方向**：把会话里的卡点按「能写成检查」「只能写成说明」「只能人判断」分三类。

### 真实案例

in the app matt uses to make his courses a spec went up with 41user stories within four minutes there were ten tickets linked by what blocks what one ticket started the chain five waited on it and the last one stayed open on purpose as research all of it landed on one branch twenty eight commits and almost fourteen thousand lines merged a little over two hours after the spec was written five days later the next features pull request

### 两个反驳

had its own merge danger section two-way door blast radius deploy ordering isn't this waterfall with extra steps that's the most common pushback and uncle bob made the case on matt's own livestream watch what happens to the spec though once the work ships matt closes the issue and the spec is gone he calls a spec a projection of the decisions made during grilling and by then those decisions live in the code the tests and the glossary

the prototypes keep it from turning into waterfall and anything small enough for one session gets planned in one session the other pushback says smart models don't need this much structure one builder switched to p-stack the stack from our last video because matt's skills felt too defensive for today's models most of them cost nothing until you call them though sixteen of the twenty-seven skills in the plug-in only exist when you type their name

### 技能会越变越少

so the agent never sees them and in his tutorial the whole installed set took up six hundred sixty tokens he also deletes skills once the models catch up version one point three removed the merge conflict skill because the harness can handle it so what's inside the repo with more stars than react open grill me which skills.sh counts at over a million installs it's one line long call the skill tool with grilling the grilling skill it calls

### 决策归你，刀归你

is twenty-eight lines and matt calls the original grill me the most influential four sentences I've ever written there's almost nothing in there to copy the value is in the questions and only you can answer them so what are you there for the decisions the agent can write every line of the pause feature and every call inside it still belongs to you the billthe bag the words skip matt thinks of agents as brilliant tactical programmers

who need a strategic one above them so the agent is the sergeant and you're the general our customer pauses on the twenty-ninth gets the bag that was already packed and pays nothing more until the resume date you decided that in round two on your coffee break I'm kevin when something new drops in AI or tech I take it apart here and tell you if it's worth the hype subscribe so you catch the next one


## 综合解读

片子的论证是一条链。一句需求里藏着很多没写出来的决定，agent 会替这些决定填空。让它别乱填的办法，是在写代码前把决策逐个问出来。问出来的结论要落成 spec，spec 再按上下文预算切成 tickets，每张票在一个干净会话里跑。跑完的代码要过两关：一关是对照 spec 的评审，一关是对照编码规范的评审。最后用 retro 回读会话，把反复出现的摩擦变成检查或规则。

这条链有几处前提。决策树要问得动，前提是 agent 知道哪些事该问你、哪些事该自己查。tickets 能并行，前提是依赖关系真的成图。评审能分担，前提是编码规范写下来了。retro 有用，前提是人愿意看报告。少了任何一条，链条会退化成一句更长的提示词。

片中数字都来自讲者自述。小改动约 6 个问题，一般 20 个，最多一次 46 个。一个百万 token 的重构拆成 7 张票。真实案例 41 条用户故事、10 张票、28 次提交、约 1.4 万行，两小时多合并。27 个技能里 16 个按需加载，整套占 660 个 token。这些是量级参考，没有第三方核验。

边界有两处值得留意。第一，这套流程对「一个会话能干完的小事」是过度设计，片子自己也说小事在一个会话里规划。第二，技能写得太防御会拖慢强模型，片中提到有人因此转用 pstack。防御到什么程度，要按模型能力和任务风险调。

可迁移的素材有四个。grill 的提问方式，可以脱离 skill 单独用，就是「你一次问完，每题带推荐答案」。seams 的概念，把测试要戳的位置提前说清楚。pr 的四栏，特别是单向门和双向门。retro 的边界，只建议不动手。
