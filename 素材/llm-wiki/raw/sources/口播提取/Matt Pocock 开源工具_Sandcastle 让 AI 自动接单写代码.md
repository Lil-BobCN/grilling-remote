# Matt Pocock 开源工具：Sandcastle 让 AI 自动接单写代码

> 作者：ChHsich
> 来源：https://www.bilibili.com/video/BV1CWgJ69EGE
> 平台：bilibili
> 口播状态：asr，partial
> 主张状态：视频观点未经独立核验

## 一句话摘要

Sandcastle 是一个 TypeScript 库，把编码 agent 关进沙箱、按 GitHub issue 标签自动接单，再跑「计划—实现—评审—合并」的流水线。作者用它把多个 agent 并行起来，做成一条不需要人盯着的软件工厂。

## 阅读路线

先读口播文章，再看文中的思考书签和综合解读。作者观点、Agent 分析和待外部核验事实应分开阅读。

## 来源与提取记录

- 内容 ID：`BV1CWgJ69EGE_p1`
- 音频时长：`684.849` 秒
- 音频 SHA-256：`91a408886756368e3273927a2908895f125dca968c846f8937989ff666a43555`
- 提取路径：`asr`

## 口播文章

One of my goals for the last six months have been trying to get my agents,my coding agents to run totally AFK.These AFK agents have been picking up backlog tasks,have been implementing features for me,have been doing QA,and crucially they have been running in parallel,so I've had lots of them running at the same time.However, in order to get them to run properly,you need to handle the permissions requests that they make.

And a question that you probably have right now is how do I get my agent to run without it constantly battering me with requests for permissions?Now, of course, you could just go into YOLO mode and have it totally bypass any permissions requests.But if you do that,Claude will do mad things on your system,like delete your home directory.Or if you're in an enterprise setup,then it might be concerns about exfiltrating data

or sending your code off to a random third party.So in order to get agents to run properly AFK,you need them to be sandboxed.And there are a bunch of solutions for this.However, I was not particularly happy with any of them.The one I really tried to use and try to make work was Docker Sandboxes.However, there were just so many problems with running it AFK that I won't bore you with now.What I wanted was a simple TypeScript function

that I could run and just say,run this prompt inside this sandbox using this agent.And all the tools that I found were trying to sell me some third party service.So I realized I needed to build something here.And that thing is Sandcastle,a TypeScript library for orchestrating AI coding agents in isolated sandboxes.You can use this to build TypeScript scripts here,where you simply say run, passing in the agent,passing in the sandbox and passing in the prompt.

> **思考一下｜AFK 的真正门槛**
>
> 「无人值守」不是一个模型能力问题，而是一个**权限边界**问题。你能让 agent 跑到不需要点确认，是因为它被关在了一个即使犯错也伤不到外面的盒子里；而不是因为它变乖了。
>
> **可以追问**：你的场景里，「盒子」的边界画在哪——文件系统、还是整个客户数据？
>
> **可延展方向**：把权限收窄到「只能读这个目录、只能推这个分支」，往往比放宽权限更省事。

If you look in any one of my open source repos,you'll see this little sandcastle or dot sandcastle directory here,which has a main.ts file.And this is full of these sandcastle.run little functions here.With this simple function,you can build really, really complex systems.You can build systems that parallelize agents running side by side.You can have systems that review their own code and then merge it in.I've been really, really enjoying using this.

And now I think it's time to make a video on it.Let me show you how to get this set up inside a repo.We first run npm install AI hero sandcastle.Once that's done, we can run npx sandcastle init.And you'll first be asked to select an agent.Let's select claw code, why not?You can then select between one of the first class sandbox providers that we provide.My plan in the future is to add many, many more of these,but, and you can also implement your own, if you like.

For now, let's just choose Docker.Sandcastle also uses a backlog manager because AFK agents need some way of picking up tickets and knowing what to do next.My preferred way of doing this is GitHub issues.We also ship with five templates here currently.I mean, there may be many more by the time you run this.Let's actually max out here.Let's go for a parallel planner with a review step.And since we've chosen GitHub issues,

we're going to create a sandcastle GitHub label.The issues will be filtered by this label.And it means that only things with the sandcastle label on our GitHub issue list will be picked up by the agent.We can see at this stage that a bunch of stuff has been thrown into a dot sandcastle directory just up here.The thing to know about now is this Docker file here,which is essentially the Docker container or the instructions for setting up the Docker container

that we're gonna be using.Sandcastle runs inside this Docker container.And it means that you can just install anything you like inside here.We're installing some important system dependencies.We're installing the GitHub CLI.We're doing a little bit of setup to rename the home directory to agent.We're installing core code.And then we're just ready to go.So let's go ahead and build this default Docker image now.That was really fast and it has now completed.

Our next steps are we need to set the required environment variables in dot sandcastle forward slash dot n.If we have a look in dot sandcastle,where it is a dot sandcastle forward slash dot m dot example,we can see that we have an anthropic API key and a GitHub token required.If you want to use your cloud subscription instead of an API key,then you can head to this issue here that will tell you more about it.If you don't know,

anthropic is a little bit funny about people using their subscription for these kinds of things.And so there's some up to date advice there.For me, I'm gonna copy over some environment variables that I've had already.And once that's done,I'm going to go into my source control.I'm gonna commit this code and I'm going to push it up.Because I'm gonna show you how we can use GitHub issues to schedule some work for this agent that we've created.

So let's go to our repo and create a new issue.Let's say scaffold me a basic TypeScript template in the repo.Give me a basic TypeScript application that uses vTest that uses type checking that has a very, very simple CLI that I can call.Use commander for the CLI,add a CI script that does type checking and runs the tests.So now I'm going to create that issue and we can now run our agent to see what happens.So after that, it should be ready to be picked up.

First, I'm going to add this little piece of code to my package.json here,which is just going to allow me to run a script here.So let's say scripts,and then add this sandcastle script here.This is just going to run NPX TSX.And TSX is just a way that you can run TypeScript as a script.And it's going to run this file,dot sandcastle forward slash main dot MTS.So let's actually go ahead and run this and see what happens.

We can see immediately that it's kicked off a planner agent here and we can control click these logs to see what it's up to.We can see that it successfully set up the sandbox.It's the planner agent running on Docker and it's looking at the open issues here.And it sees that there's only one open issue.It then spits out this plan here,which is a set of issues which are going to be worked on.Finally, at the bottom here,

it shows the amount of context window that it used.If we zoom back to our terminal here,we can see that an implementer agent was kicked off too.Let's control click these logs and take a look at them.And we can see that it called GitHub issue view one.It has a clear picture and it asked for a basic TypeScript script app,vtest for testing, type checking,simple CLI using commander, great.We can see that it's running bash commands inside here.

It's doing good dependencies installed.And I've even got it prompted so it's doing a little bit of red green refactor here where it's writing the test first, vtest run, et cetera.We can see it all happening.It's now moved on a little bit further and we can sit and watch this if we want to,or we can go and have a cup of tea, we can relax and this will just do its work without us.So while this is running,why don't we go and have a look at the main.mts file here.

We can see the planner that we saw earlier is just down here where we have a sandcastle.run command.That takes in a name of planner.It takes in an agent here.So we can just change this if we want to.If we want to do planning with codecs, let's say,instead of Claude code, we totally can.And it's also using this prompt file here.So plan prompt in here.This is scaffolded by the template and you can totally edit this as much as you want to

to run anything inside a sandbox.This one is taking all of the open issues from the repo that have the label sandcastle.It's grabbing all of the labels, all the comments,grabbing all of the comments body as well.And then it's working out which ones can be done right now.So it's only looking for unblocked issues here.And finally, we tell it to output its plan in adjacent object wrapped in plan tags.If we go back to main.mts,

we can see that this then gets picked up here.We then grab the JSON out of the plan here and figure out the issues.And then for each of the issues,we run a separate sandbox here.We run an implementer.And this one has an implement prompt that's just inside here.So implement prompt.This one takes in some prompt arguments here.So it takes in an issue title.It takes in the task ID, which is the issue ID.Then it says you're gonna be working on a specific branch.

Again, all of this is just a setup that I cooked up, really.This is not sandcastle giving you any kind of prescription on how you want to run it.This is just a really cool workflow that I tend to use in my repos.So I figured it belonged in a template.If we zoom back to main.mts,we can see that the result here is captured in a variable.And if there are more than one commits here,we then run a reviewer.This pattern has been incredibly powerful

because the implementer can make mistakes,but the reviewer generally picks it up.And of course, if you want to do an adversarial review where you have one agent run another,or review another agent's code,then you can just do sandcastle.codex.If you want to have multiple different agents spawn at the same time, come up with an implementation,and then some other reviewer takes all of those branches,chooses the best one, or makes like a mix of them, you can.

That's the power of having a totally agnostic setup to what agent you're running.That's the power of using your, or owning your own process.Anyway, let's take a look at the review prompt here.It's worth noting this little syntax here,because this is really nice.This is something I copied from Claude's skills,where if you specify an exclamation mark before a bunch of back ticks here,it will run this when it's resolving the prompt.

And so it will actually execute git diff source branch branch here.This review prompt just uses a very basic process,understands the change, analyze it for improvements,check correctness, maintain balance.And crucially, it's a great step for like adding your own project standards.So for instance, I've added this coding standards in here that you can fill in with any project standards that you want to be added.Let's look back at main.mts,

and we can see what happens after all of these branches get created.We can see that they then get passed into a merger agent down the bottom.And this one takes all of the branches,takes all of the resulting issues,so it understands the changes that were made,and then merges them back to the main branch.The reason we use an agent for this is that there might be merge conflicts between them.And I usually like to have a really powerful agent

handling those merge conflicts for me,because they can sometimes be pretty gnarly.And so at the end of this,we have had multiple agents running at the same time,all committing to their branches,and then we get like a senior merger developer to pull them back into main.Just this setup has massively increased my velocity,and it works super duper well.

> **思考一下｜流水线里最贵的一段**
>
> 计划、实现、评审、合并，四段里真正决定质量的是**计划**。实现错一段可以重跑，评审漏一处 reviewers 还能补，但计划把需求理解错了的话，后面所有 agent 都在高效地做错事。
>
> **可以追问**：如果客户说「我想要个能导出 Excel 的功能」，planner 拿到的到底是什么？
>
> **可延展方向**：把「需求翻译」单独拆成一道工序，产出可验收的验收条件，而不是让 planner 顺手猜。And again, Sandcastle is not opinionated here.If you wanted to make these into PR branches,

you totally could.Okay, let's go and check in with our running process,and let's see what happened.All right, we can see that we had an implementer kickoff here,then a reviewer, let's check the logs for the reviewer.We can see that it found that the code was already clean and well-structured,minimal scaffold template naming is clear.And then let's see what happened in the merge,so we can just pull up the merger here.

And the merger ran the type checks,it merged in the branch,and it also closed the issue with a comment, beautiful.We can see too that if we go and have a look at the rest of our code base here,whoa, we now have a bit more code going on.We have a tsconfig.json,we have a vtest.config.ts,and we have a few files looking about inside the CLI here.So you can start to see how Sandcastle is working here.You can build these relatively complicated flows

using a simple primitive,using really nice ergonomic markdown prompts.You can get it to run on different branches and just merge that back into main,or you can get it to do really nice PR flows as well.You know, it's just code.It is a programmatic way to run Claude code,to run codex and to build these workflows that turn into these mini software factories.I've been incredibly happy with it,and I'm really excited to see what you build with it too.

If you're thinking about these hard problems too,then you should check out my newsletter for AI skills for real engineers.These follow the skills repo that went absolutely viral a few days ago,and I also post tips and tricks there for getting the most out of agents using good old software fundamentals.So thanks for watching, folks.I'm really excited about this tool.I think it's gonna be a really nice contribution to the ecosystem, and I've been loving using it.

So nice work, and I'll see you in the next one.

## 综合解读

**论点链。** 先立前提：agent 要真能 AFK（无人值守）跑，就必须放开权限；而放开权限意味着它可能删掉你的 home 目录、或在企业环境把代码外传。于是「AFK 的前提是沙箱」成立。作者试过现成方案（Docker Sandboxes）不满意，又不想被第三方服务绑定，于是自己做了最小的那个原语：一个 TypeScript 函数，传 agent、传沙箱、传 prompt。

**接单这件事。** AFK 的 agent 需要一个「知道自己下一步做什么」的来源，作者的选择是 backlog（这里选 GitHub issues，配一个 `sandcastle` 标签过滤），也就是把任务队列交给已有的 issue 系统，而不是新造一个控制台。

**工厂的形状。** 模板给的是四段：planner 读未完成的 issue、产出可执行的计划；每项计划起一个 implementer，在独立分支上写代码；提交数多于一个就拉一个 reviewer 看 diff；最后 merger 把所有分支合回 main，并顺手关掉 issue。作者强调的是这里没有强加的流程——`sandcastle.run` 是原语，流程是脚本，所以可以并行、可以对打评审、可以改成分支开 PR。

**成立前提与边界。** 这套东西依赖：issue 的标签与依赖关系足够干净（planner 只看未阻塞的 issue）；每个 agent 有足够的上下文窗口与独立分支；合并冲突需要一个足够强的 agent 兜底。作者也承认「这是我自己习惯的工作流，不是 Sandcastle 规定的」，意味着可迁移的是**结构**而不是具体参数。

**回到你的场景。** 视频里唯一没有的正是你要的那一段：客户是不写 issue 的人。Sandcastle 假定接单口是 GitHub issue、由懂行的人维护标签；你的需求是把「客户用自然语言说需求」这件事翻译成那条 issue，并且仍然让客户看到进展。这个翻译层就是这张地图要解决的核心，也是最容易做错的一层——做厚了变成又一轮 Grilling，做薄了 agent 接到的单根本没法开工。

**待外部核验。** 视频中提到的包名读作 `AI hero sandcastle`、初始化命令 `npx sandcastle init`、模板名与 provider 列表，均为口播 ASR 转写，未经 npm/GitHub 一手页面核对。
