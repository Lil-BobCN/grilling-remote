# pstack 作者：每月 2500 个 PR，睡觉时 AI 还在干活

> 出镜：Lauren Tan（poteto），主持：Matt Pocock
> 来源：https://www.bilibili.com/video/BV1AjH66gETc
> 平台：bilibili；B 站整理：山人自有GoodIdea
> 口播状态：本地 ASR（英文），partial；正文保留英文原样，编辑层为中文
> 主张状态：视频观点未经独立核验

## 一句话摘要

65 分钟访谈，Lauren Tan 讲她怎么从手动管一个 agent，走到每月约 2,500 个 PR。路径是验证技能、环境约束、内外循环和抽样验收，边界是领域的可验证性。

## 阅读路线

先看「验证」和「环境」两节，那是整条梯子的两个支点。再看 2,500 个 PR 怎么来，那里有内循环、外循环和协调 agent。最后看验收和单向门，那里讲人还剩下什么。

## 来源与提取记录

- 内容 ID：`BV1AjH66gETc`
- 音频时长：`3935.531` 秒
- 音频 SHA-256：`6427852443f1ba6fe6906c59aa6b46a6d736e5d570f56cb7d6285feada047275`
- 提取路径：`asr`
- 说明：原始转写没有记录片段数和末段覆盖差。正文是英文 ASR 原样，只加小标题和书签，没有改写。专名听写问题见 wiki 的待确认页。

## 口播文章

### 从 2,500 个 PR 说起

So hello folks, I've got another treat for you today last time on this kind of podcasty thing I suppose we had Uncle Bob and we talked about software quality. We talked about agents We talked about lots of cool stuff now We have an incredible guest someone who I'm delighted to welcome on who's been exploding on Twitter recently about software factories about increasing the quality of your work about increasing your velocity and

Climbing the trust ladder with agents so that you can ship more and more and more and it is Potato welcome. Thank you so much for joining. Thanks for having me. Yeah, very excited to be here Yeah, I'm yours and a huge fan of yours I think people have been talking about this like it's like the meeting of the skill minds Yeah, the skill Mount Olympus or something because both of us have very popular skill libraries I'm not as I was saying before we started I've not used a ton of yours and like I want to get

All of the juice out of your brain so that I can go and use it Yes, I think where I want to start with this is you gave a talk pretty recently I get about 10 days ago and post it on X which went absolutely nuts as about how I shipped 2500 p.m. Last month's production got about three million views or something on X and I watched it and I loved it and I recommended it and I kind of want to run this is almost like a Q&A of that talk basically of

giving you I just had tons of questions about it and I wanted to dive into it and I think where I want to start is You talk about a trust ladder with agents Where you as you trust agents more you can get them to do better and better things And or scale them up to use more and more agents So what is your story of how you climbed the trust ladder and How did that work when like you've got SpaceX and started climbing more and more

### 从 Meta 到 Cursor：先当保姆

So I think this the the journey sort of began even before I joined cursor, which is now SpaceX AI So the story is After meta so I used to work at meta on the reacting I took a month off because I was feeling kind of burnt out And of course when what do you do when you're burnt out you go and start a new side project And so I started a side project, you know, I was Of course using AI to write code But then I started to realize

You know spending like so many hours just micro managing one agent Right and you know at the time this was back in February. Maybe February early February or January You know people are really obsessed with this idea of like orchestration This was like, you know before you know things like cursor, you know, like the agents window this had become popular So people were still in like like to we land, you know in their terminal and they were all talking about

You know, I built a custom orchestrator, right?And so of course I had I was a bit nerd sniped by that And you know as I was building my toy project I got nerd sniped by oh, how do I make my AI coding setup more efficient?and so, you know, I I kind of started the journey there where I just you know took a step back and realized You know, I was spending all this time micro managing a single agent You know, I was creating skills and I was like finding it quite difficult to measure the output or the the results the impact of the skill as well

So I was kind of flying blind, but I was you know iterating really fast um and um So that project eventually sort of became the basis of PSAC even though I didn't know it at the time and a lot of Some tricks I had learned like building that early set of skills Actually, it's still open source if you want to if anybody wants to take a look. It's on my github like potato slash a noodle n o o d le And in there you will see some skills and a brain directory

as I was really interested in this idea of how do I You know extract my own Ability if that makes sense and give it to the agent All right, because I was I realized that you know, all I was trying to do was trying to teach the agent to write code more like me You know do you do workflows more like me?So, you know, the skills were like an entry point to doing that Um, and then you know after I joined cursor, uh, I was starting to work on the agent's window and uh, it had a lot of performance issues

It was it was pretty laggy Uh, and so since I had experience working on react I was asked like hey, do you want to come and help out with the agent's window?um, and so The the beginning of the cursor journey was very manual Uh, I was deep in like looking at like flame grass and heap snapshots and trying to see like why exactly is the app so slow Uh, but then coming back to the same realization that you know, I was sort of the bottleneck

Uh, I was doing everything manually. I was sort of the meat proxy in a way Or I was the meat proxy between my agent and chrome dev tools Uh, and I was like really annoyed by that And what month of the year is that let's say where are we in the timeline?Uh, so I joined cursor in march. So this was like early early april probably early april is when You know, uh, I joined and I didn't have any skills or I had I I sort of abandoned my

Personal skills because I didn't think they'd be relevant anymore. Uh, but then working on the agent's window And now working on grog bot I sort of realized that a lot of the Lessons I had learned from those skill time building the the initial set of skills were very relevant Especially around things like verification Uh, you know being very rigorous in your work um Because I think agents from my experience even the the frontier ones tend to

### 让简单的事变成对的事

Tend to take shortcuts. Uh, they tend to do the easy thing Uh, so a lot of the skills that I've built have been around How do I make the easy thing the right thing? You know, how do I make that the best thing?the idea of sort of distilling your expertise and Turning what you do every day into processes. That's something that feels super familiar to me That's exactly what I've been doing with the skills and I suppose There's something in that which is a lot of people think domain expertise is getting less useful now as people

### 领域知识比以往更重要

Uh start to rely more on ai Where what do you think about that just as a sort of vibe check before we start?I actually feel like domain expertise is is more important than ever you know, uh I think I wrote this on my x at some point, but You know at times I sometimes think of you know ai as this Like especially as the models get smarter and smarter and more capable and the frontier models are just getting so good Like I love opus 5.5. By the way, um

You know as the models get really really really good It almost becomes like the bottleneck is no longer the agent, right? It becomes Your ability to express your intent and your goals in a clear way that the asian can understand and Actually carry out and that's why I think you know like people with a lot of domain expertise are extremely Have a have a huge advantage in my opinion, especially if you're a little bit like, you know, tech

Techno curious, you know, so I think of people like, you know, like, uh, like a doctor or a lawyer or You know someone who who has a deep expertise in a particular non-engineering domain And if they're actually just a little bit tech savvy and they can figure out how to use agents They can actually build really really great products, right? If they if they have a clear enough Vision in their head and they can articulate it in a way that the agent can build it, you know, I think that

That is really the The bottleneck these days is is like the transfer of your intent, right and your vision to the agent Yeah, I've been obsessed with language basically since agents. Yes Dropped I just Thinking constantly about the the composition of words how I can make things sharper. What?What might be hidden in the phrases that I'm using and it's and finding What I love is when you find a word that the agent then hooks onto and then goes, okay

### 词是压缩过的意图

I'm going to reinforce that word. I'm going to reuse that in my thinking traces You know, I found that with um tdd was an early example of that a lot of chat about tdd recently of like, you know People say should you use tdd with agents? It doesn't matter. What you're doing is you're getting the agent to think about tdd Getting it to write tests getting it to prioritize things in a different way than it did before and that's why sort of grilling

I think works effectively. Yes grilling is a yeah It draws those words out of you, right or at or at least it helps the agent Understand your thinking so that it can propose those words to you and you can pick up and say yes exactly that I've actually copied some of the the tips that you've shared as well But you know one of my favorite ones that you've shared recently or or not or like maybe in the past couple weeks

> **思考一下｜语言是压缩过的意图**
>
> 一个词能省掉一段解释。agent 抓住词以后，会在后续推理里反复用它。所以词选得准不准，直接影响它想不想得对。
>
> **可以追问**：你团队的口头禅里，哪些词其实在帮 agent 偷懒？
>
> **可延展方向**：把项目里的高频词收进词汇表，每个词写一句定义和一句反例。

is about uh, reducing or eliminating Critical tests like one of my pet peeves of agents is like all of the useless tests that they write and so, you know That was one thing where you know the word tautology, right is is is I guess, you know Not many people necessarily know that if especially if English isn't your first language But there's a lot of meaning to that word and it's like It's almost like compressed right like you compress a lot of intent and meaning into

Words and so I totally agree if you like I think language. I've always been interested in language actually like programming languages Natural human languages and how they came to be and it's so interesting that now with agents. It's sort of like this meeting of Natural language with programming language, but it's all it's all language out of the hood. It's all communication Totally. I did a drama degree, right? So, you know, I've been thinking about language and Shakespeare and stuff for a long time

### 为什么不用软件工厂

And so this all feels very familiar. Yeah. Um, so, okay, there's sort of before we get into like because I think the thing I want from you is like software factory stuff, right software factory is the big buzzword software factory is the thing that I'm thinking about too I'm sort of releasing a course in that direction too and it's this sort of scaling yourself up to Unrealistic numbers of prs basically or pr numbers that sound ridiculous to people who don't understand how this works

So where I want to get to is sort of from people who are doing kind of like One to five agents today up to, you know hundreds of agents running at once and how that sort of functions And so I'd love to hear about your metaphor of the Michelin kitchen Instead of the software factory because I think that says a bit about the way you think about this stuff. Yes Yeah, I I've I've never really liked the term software factory

Not because, you know, it's not accurate, but I think I think the a lot of people when they think factory, right?they don't necessarily create that with quality Or craft Right things which are very important to me and a lot of people and technologists who work, you know building products we care about The user experience we care about the things we're building So what so while I do think software factory is an apt term

It also I guess maybe conjures up negative, you know, maybe sometimes negative connotations So Michelin kitchen is the thing that I've sort of landed on where it's much more I feel like it's much more aspirational and Uh, I like the metaphor a lot because you know, I like food. I'm called potato of course And I like cooking and I see a lot of parallels, right?like with Food right when you're cooking a meal for yourself, for example

### 从家厨到主厨

It's both utilitarian like you're trying to just feed yourself, right and survive But it can actually be transformed into art, right?And that's what what a Michelin starred chef or even just a chef or a cook can do with food Is take something very ordinary and turn it into a delicious meal that you know takes you back to your childhood days or something like that um And so it almost like mirrors that trust letter that I talk about where

Uh, you can sort of imagine your own journey as a home cook, right?As a home cook, you are doing all of the food the cooking yourself You cut all the vegetables you do all the prep work You do all the cleanup, you know, you are the one man or a one woman show really?um And it's an interesting thought experiment like okay if you were to cook a meal And then you add people right your your partner enjoying to your brother or your sister and now suddenly you have your whole family in the kitchen

I think most people would get very stressed by that right the thought of so many people are just mucking around in my kitchen They have no no idea where all the utensils are they're either max capacity of one person in the kitchen. Yeah exactly. Yeah, absolutely so I feel like that that's really out because When you ask yourself that question of how do I go from being a solo cook, right?To having an army or even not not even an army, but a few sous chefs, right that are helping me in the kitchen

How do I think about dividing the work in a way that makes sense?You know, I'm not dividing work just for the sake of it But in a way that actually makes the some the the better than you know, the total of its parts and so the michelin kitchen metaphor to me like works really well in that regard because you know as a chef You're you know, if you become a chef you're in a position where you're not necessarily cooking all the food yourself anymore

But you are thinking You're almost like the tech lead right for the kitchen Where uh, you know chefs have to think about you know, not just cooking but they have to Basically organize the whole kitchen and they're like the CEO of the kitchen They have to think about when do you order ingredients? How do you store them? How do you prepare them?When do they have to be prepared?You know, it's a whole it's a whole job, right? That's not just cooking

um, and I think that again it mirrors so much of How engineers write code today where you are not writing the code yourself anymore. You have agents, right?But you as the human are still responsible for the final outcome, right? Your name still is associated with the work that you do your reputation and You know, so how you set up your kitchen, right and how you set up your skills your environment your code base I think

Are ultimately the new ingredients that go into um building product Yeah, I think what I love about your approach is the amount of focus that you put into the environment that the agent operates in Right, because I think a lot of people they think right the agent is good. Um Probably not going to be able to make it better. Let's just trust what these magic model people have put into the harness and the model combination

### 环境是新的食材

Uh, there's nothing I can really do like I can't mess about with cool codes internals or something or whatever you're using um But what I love about Your approach and it's something I advocate for too is that you can change the environment the agent operates in right?You can make changes in the code base and also give it tools for verification as well And allow it to verify its own work So the thing I I loved about watching that talk is the amount of focus you put in verification

And like that is the lever that you can start to generate trust Can you talk about that and what that concretely looks like?Let's start like looking at practical ways that people can improve their own processes their own kitchens Yeah, I've I've said this a lot actually that You know, even if you don't use p-sac or you know your skills I think that the single most important skill that should be in your toolkit Is verification because without verification and for for by the way for those watching

### 验证：给 agent 手和眼

Don't know what that means. It's this idea that you can give you can sort of give your agent Uh hands and eyes in a way. That's the the analogy I like Where the agent is able to run the code right and actually uh interact with it like a normal human user would and also do things like you know debug it, you know take traces and snapshots um and uh Funnily enough like that was actually the first skill I built when I joined cursor

That gave me a lot of that was that was the thing that actually started to let me Send the trust ladder a little bit in a way that some of the other skills I had looked at Or built had not really let me through Because no matter how good, you know, some of the other skills were like the how skill the why skill the Unslop skill were I was still relying on me right as the proxy between my agent and the output So that you know if the agent can actually see the result of its work

There's no way it can actually iterate Right and so this is where people start to talk about loops this idea of a loop And really I think the term loop, you know seems kind of uh almost Abstract like people that what what what what is a loop? What is an agent loop?But really to me like the most important part of the loop that allows it to be a loop is the verification part because the agent is able to to verify its own work and

You know that takes you out of the equation where now I can actually do something like So the very one of the very first use cases I had for verification was you know Like the performance work that I was doing on cursor's agent window And I wanted I wanted to get to a point where I could do something called hill climbing Uh, which is a term that I think the labs I'll talk about a lot, which is this idea that you know, you have some kind of

Rubric or a way to judge or score something And now because you have a loop you can have an agent continually try to make improvements to that Uh, I think carpet the andre carpet the also famously released something called auto research that has a lot of these ideas But yeah verification, I would say is probably the most important skill in p-sac and many other You know two sets And I think it's the most important thing to focus on so a lot of the

A lot of I spent a lot of time actually, you know, tuning the verification the creative verification skill And also internally the the we have so many verification skills now like every app that cursor has or SpaceX AI has has a Verification skill that is auto maintained as well And it's become critical infrastructure for our team because everybody uses it And you went pretty far with that too, right? Like you had a um in your talk

### 把确定性写进 CLI

I saw that you actually built a custom cli for that too So what does that cli do like how does it execute things and why did you I mean that's proof of how deep you're going Right of how much you're pushing that Yeah, so This is actually a tip I learned early on where uh I guess, you know back in january or or late last year The thing that people were very concerned about was context window, right? That was the big the big topic at the time was

How do I you know manage the context window because you know compaction summarization wasn't really that good yet And people were always people had this there was almost this meme in the community that You know once your agent summarized or compacted once it would become sort of stupid, right for the rest of your session So there was a lot of thinking around like You know being very efficient with your context usage and so that was actually the inspiration for some of the

The cli work inside of the verification skills I guess now it's less so about context because uh, you know agents are Much better or harnesses have gotten a lot better with summarization um I still think there's some benefits to you know, uh having a clean context window So the cli is really just more of a way for me to Take the deterministic parts of what the skill does and encode that into a script or cli

to reduce to kind of take away the judgment That would otherwise unnecessarily be used because with judgment So in I also think of you know agents and skills and sort of like Is like a gradient You have some parts of the work that are entirely judgment based, right?You know something that requires thought, you know putting together multiple pieces of context thinking um, and then you have the more deterministic parts like I don't know if you wanted to

or Refactor some code right from one pattern to another. That's very mechanical, right? You don't you don't need an agent to Think about it and come up with it in a novel way each time All right, and so that that was really the inspiration for the cli and you'll see this in a lot of the other skills that I built Is like I try to extract Out the deterministic parts and turn that into code and just leave only the parts that actually require judgment to the agent

So in a way, I think of the seal is kind of like your wrapper, right?It's a wrapper with some light instructions around how to use these custom tools that are inside of the skill um Oh, yeah, I don't think the seal is really that interesting in its own really it's not like a novel piece of software It's just something that interacts with like playwright and the chromed dev tools protocol and calls a bunch of apis It's like it's just a bunch of glue

No, it's fascinating because it's a way of hiding information from the skill, right?It's a way of conserving the skill keeping the skill quite small I imagine and then you're able to delegate more of the complicated deterministic stuff into a script within the skill So it's almost you're compressing information and making the agent do more consistent things more Consistently, yeah, that's fascinating. Yeah, and it also helps. I guess if you care about context window, it does help

because now the agent doesn't need to Uh, you know reinvent things because one thing I had noticed early on when we didn't have a cli was that Well, the the agent would try to verify it's work But it would basically rebuild the world each time and then every agent did it differently And I was starting to notice like that's very inefficient. I was wasting It was actually not just about context usage, but also speed All right, like as now my agent had to actually go off and write the scripts or the cli and test it and you know

And it doesn't work and the last agent did it and it worked but I discarded it So it was just very obvious at that point. Like I should just turn this into a cli and put that inside of the skill Uh, so that every agent that uses it now benefits from that same piece Um, but I I also think like, you know, it's a good push for people to think about Is how much of your skills and rules could actually be deterministic?um, that's like another core thing or one of my core principles that I like to think about is

> **思考一下｜为什么要固化成 CLI**
>
> agent 每次重新造验证脚本，等于每次重新发明轮子。固化成 CLI 以后，行为一致、上下文更省、速度更快。
>
> **可以追问**：你们有哪些步骤，其实已经稳定到可以写进脚本？
>
> **可延展方向**：把一次会话里重复三次以上的操作挑出来，做成命令，再让 skill 去调。

Yeah, how do I Make very efficient use of determinism and non determinism and You know, let agents shine at the non deterministic parts, right? Because that's what they're trained to do um, and The other parts which are much more mechanical or you know, straightforward can be just pure determinism And you'll see this as well for things like doing migrations um, which is another big thing that I've talked about is you know

Going from one technology to another especially one that is better for our agents, right?And a lot of how you can do that migration is I think through Things like scripts and cli is like the deterministic parts like code mods, you know, like crawling the ast The abstract syntax tree and transforming code literally mechanically right like a script does it for you instead of the agent Totally makes sense. I I mean I think what there's another thing there, which is

You're taking stuff away from the agent and you're kind of putting it in the environment to a little bit Which is let's say you have a a thing that you notice the agent always gets wrong you want to make that um, just impossible within the environment and that sort of comes down to code quality as well. I mean I talk about a lot like having a What a good code base means right? What is a good code base?And there's a definition I like which is a a good code base is a code base that's easy to make changes in

right easy to um Change stuff without things screwing up and that means that you have a lot of guardrails that you have a lot of The agent or the human is constrained to very narrow paths and that's again something you talk about in your talk and you talk about there's not only on the kind of Sort of automated checks side of things so linting and time checking blah blah blah But also in the way you design abstractions and you guys even I think built a framework

### 工程师的新工作是搭环境

for your agent to work into I think what I'd love to hear is You obviously think of that as very important right and that's How important is that compared to other things you could be doing like building features or shipping work?Yeah, I think that's um I almost feel like the new job of the engineer is really to to spend time on the environment um, I almost actually wrote a tweet about this yesterday, but I but I didn't

but I think that I think that you know if you if you haven't really spent time You know building trust in your agents and building skills and tools You can get stuck in this mode where you're very low on that trust ladder, right?You don't have a lot of trust in your agent's work and so The only way to cope in that when you're in that situation is just to kind of lock in and Micromanage your agents and that's very time consuming and when you're stuck in that mode

You don't really have the luxury to think about you know Uh higher level things like like making yourself more productive in the same way that uh I guess analogy would be like if you've never taken the time to learn like your tools or as a developer when you're writing code yourself And you know, you have you've never heard of vs code. You've never heard of vim. You only knew about notepad And you hadn't hadn't even heard about git. That's sort of the analogy. It's like you you haven't spent the time

sharpening your own knives Right and so of course if you have a dull knife then everything can take a long time And you know, you're just gonna be And especially if you know deadlines are looming Then you don't have the now you're stuck in this rut, right where where you you you don't have Sharp knives. You don't have good tools, but you're under all this pressure to ship, right?And so all you can do is just focus on that

But I do think that you know if you can find yourself the time to actually spend time thinking about your setup It's again going back to the cooking, you know an analogy It's like, uh, you know, if you for example, if If cutting cutting cutting the garlic is like super slow, right? There are garlic and mashers, right?You can you can buy and you put it in the thing and you like squeeze it out, right? It's super fast Uh machines and tools are invented for a reason, right?

And so if you're operating a Michelin kitchen and your your your cooks had no tools Then of course everything is going to be extremely inefficient Very very you know every every every cook is going to make something up of their own So I think the tools and the determinism to me are You know taking that part away and and just like you said about constraints as well it's the constraints are to me as well like Uh, actually a slight tangent on that is uh

### 像收窄类型一样收窄代码库

I think we should talk about typescript Because like we we actually both share like a background in typescript where you know You obviously have done a lot of work with typescript and total typescript and you know, you're a leader in that space and I uh had adopted typescript pretty early and I had given like a talk or two at typescript conf many years ago and so one of the the talk that I did actually was about type systems and

constraining the constraining types like one of my most favorite things about typescript is actually type narrowing All right, this idea that you go from a very broad type All right, that could be anything and then you through typeguards and you know type narrowing and you know runtime checks you can actually narrow the space and say like oh, this isn't just a string This is a very special type of string. It's a constant, right? Like I but I I determined that through the type system

and in a way, it's like, uh, there's a lot of parallels I think to that with constraints in your code base Where is it you're constraining the space, right? If you if you think about category theory as well, you know You're constraining the the number of possible Types, right that can can exist And you're saying there's only one type, right and for for us like that framework that I'm building called dune Uh, it's not an open source framework. It's the the way I describe it to people

It's it's kind of like our internal next j s for our electron apps But it comes with a lot of really really restrictive lit rules And the code base is designed in a way that there's really only one way to do something So we make use of we make use of a lot of conventional patterns So like features all go into a specific directory Well, every feature has its own directory as an example You know, there's like a thing that discovers features like through a registry and like crawling the code base and stuff like that

at this conventional pattern And the lint rules make for an environment where it's actually very hard to write bad code And that sort of frees up the It both frees up your own mental uh, you know Capacity as well as the agent sort of doesn't have to think about that anymore Or it's just like, oh, there's only there's I should just if I want to add a new feature It just goes into the feature the new feature directory and all the code goes in there

### 看着 agent 失败，再写进规则

And I'm not going to append to a god file, right?that was really actually the inspiration for those feature directories is The very first couple of versions of grog bot or compose of like eight God files which were like at least 10,000 lines long if not longer And so I kind of had to break it up into smaller pieces Uh, but it was just observing, you know, actually that's another important part is observing how agents fail

And then every time you see a mistake every time you see something that could be done better You think you step back and think how do I turn this into a lint rule?How do I make it so that the code base makes this impossible, right?Then it comes back to me for my, you know, my background learning typescript and types type systems is how do I Constrain the space so that you know, I know precisely what I'm working with and I think yeah, there's a lot of parallels there

totally makes sense and don't I mean It's funny that you mentioned typescript and god files in the same sentence because typescript famously has a 25,000 line type Yeah, I realize Well, I don't know if they've rewritten that and go. I think they probably have, don't they?um Okay, so The environment is important You should watch your agent like a hawk to make sure that any mistakes it makes You turn them into things in the environment and the benefit of the environment is you're not overloading your agent, right?

In terms of rules in terms of things it has to remember It's just in the environment and so it stumbles into the rules and exactly You know bounces off them and hits them at the right moment So, okay, we still haven't talked about the 2,500 prs Where do those come from like how do you you've built your trust ladder?You've worked on your environment and you understand. Okay. Um, I now want to scale up So what are the mechanics of that scaling? Are you um initiating 2500 like chats per month?

### 2,500 个 PR 从哪来

That can't be right So there must be are there any kind of automated triggers that trigger stuff in your repo?Like how do you get the software factory kind of triggering work by itself?right um I'll definitely say that the prerequisite to You know something like a very high volume of pull requests um Is the environment, you know the stuff we just talked about Where I definitely would not have been able to do this if I had not spent the time

You know thinking about the kitchen and the knives and the tools for my agents and so In a way, I think of this as I've spent a time building one kitchen and one restaurant And now I I'm in a position where I don't actually have to be there anymore because the Environment, you know that the same analogy right it works well Yeah, I know the chain of restaurants, right? That's exactly. Yeah, exactly It's like you're Gordon Ramsay and you know, you've taught your executive chef like all the tricks of them of coming up with a great menu

Uh and like the kitchen is set up really well. Everything's just perfect and you're now in a position where you can open your second your third restaurant and I guess I sort of see each project that I work on like each big chat is sort of like a restaurant All right, and I'm I have multiple of them operating at the same time and I'm sort of like Helicoptering between them sometimes Some more than others depending on how in the loop I am

But yeah, definitely. I think there's there there are external triggers and context that those projects don't have that For a long time I was the proxy for that. So Uh, the best example I have is like, you know, you have a project that's working on a feature Uh, or you're trying to fix a bug and you're getting bug reports but the bug reports are going to things like slack or linear or X right and these are external systems that aren't connected to your inner loop

### 内循环和外循环

So I like to talk about this outer loop and the inner loop Uh, I don't know if I'm using the definition correctly, but to me my inner loop is like basically my engineers My agent engineers working on the code through and building towards an intent Or snapshot of my intent, right and the thing about that is that the snapshot can go stale Right new information comes to light that I then have to be the proxy of and you know transfer that context to my agent

So, you know, if you if you don't have these triggers pulling information back into the inner loop Then you sort of have to play that role Where you're you're off, you know in slack or X or or whatever and you're gathering context, right?You're getting contracts about bug reports about feature requests About, you know, something someone said about, you know, our back in infrastructure has some limitation You know all that information

You have to ferry that across to your agent So that's where I think like tools like grog bot are really good because they help you Automate the outer loop as well And when you connect those two loops, it's very very powerful because now all of a sudden Your agents have the ability to get context for this for themselves, right if for example Uh, you know either through just as a simple example like maybe you have the slack mcp

Right or you have your own Harness, right that you've built a slack subscription into for a particular slack channel Now all of a sudden you can tell your agents, okay subscribe to the slack channel every time there's a Uh, you know bug report about something go off and triage that thing, right go reproduce the issue Right using the verification skills that we've already spent time building and all of those other skills that we've set up

So that I have a lot of trust right I have a lot of trust that these agents can actually go off and Understand the bug, you know, uh, verify that the bug actually still exists on main and it wasn't Something about you maybe the user's Set up or their data or maybe I don't know they didn't install a dependency or something like that like basically, I think Creating that Yeah, creating those two loops and connecting them is really a very important part of the job these days

Um, especially if you are thinking about how to scale yourself So a big theme here is really just like always thinking about like What where am I the bottleneck in this process? Why do my agents need me, you know to answer this question?I always like to think about that and so I try to think about how do I actually get the agent to answer its own question All right, but not by hallucinating not by guessing but actually real data

And you know, a lot of people talk about this idea of a company brain or a context graph I feel like those terms aren't necessarily complex, uh Or even abstract to me it's just about, uh, how do I Take information that my agent means that I would otherwise have to go and pass it myself And just teach it how to do it, right? And that removes me from the equation And so how I arrive at 2000 or however many pr is Is the fact that I have all these loops set up, right? And so, uh, it allows me to open

Chain restaurants, right? I can I can really parallelize myself So yeah, I'm not sitting there creating two thousand five and chats, right? Of course. It's really like these projects are um Actually cursor has a new feature called projects which are these like coordinator agents um And so the coordination coordinator agents are really good at Sort of delegating and not doing work of their own But they manage and supervise like almost a list of tasks

And they spawn sub agents to go and do them and so I'm just constantly Feeding context or teaching the agents how to get their own context and then they're going off and Doing the work for me And really the big the last thing I'll say to this is like the big unlock for me for getting to 2000 prs is starting from the question and working backwards of how do I get to the point where my agent can merge its own code because

The obvious thing people ask me when when they when I tell them oh, I shipped 2000 and 2500 full requests last month They'll be like, how did you review that? Right? That this is a lot of prs to review. You're like your team must hate you Do you mind if we go there in a second because yes, absolutely a good question about that. Yeah I want to like this analogy is great. I want to like deepen it a bit which is Before if you're like manually initiating all those chats, it's like you're bringing the orders to your chefs manually, right?

Whereas if you've got an agent right I sort of like doing the expo then you're able to sort of run it yourself What is what does that concretely look like then you've got these sort of grok bots that are Subscribing to channels pulling and slack messages And you it sounds like have a couple of coordinator agents or like chief of staff agents that Like monitor that or something like when you look at your computer to manage your agents. What does it look like?

### GrokBot 是外循环的连接器

Yeah, so So, uh, this is I guess somewhat confusing but we're working on you know simplifying and unifying but so There's grok bot Which or you know, you can use other tools, of course as well But I I largely think of these tools as like your outer loop. These are tools like You know grok bot that have connectors, right? These are connectors. I guess a lot of people call them personal agents Um, but they're connectors to things like your email your calendar slack

Plaid, I don't know like all these different services and they are a great source of pulling context in to your work So the same way that a human like if you know, if I were if I was a manager and I was leading a team of engineers You know, like when I used to work in netflix one of the biggest things that managers would talk about was this idea of context not control Funnily enough, you know has so much There has so much carry over to the agents world

of you know, you You know, you of course can drive to an outcome you want by control, right? Like by micro managing But what you want is to provide context instead, right?Like teach the agent teach your engineers how to be self-sufficient and then you don't have to micro manage them Um, and so I see a lot of parallels there. Uh, but yeah grok bot So concretely I have some grok bots that Look at my slack channels. Look at my x

Or my emails Or linear and they're just constantly they have routines that subscribe So they're constantly watching and I have I'll tell them things like, you know, uh, I'll watch for issues with Bugs in the grok bot desktop app as an example And whenever you find that Send it to my cursor project. So one of the really cool things about grok bot is it connects to cursor so cursor has Like I just mentioned the new feature called projects and a project is really a

### Cursor projects：云端幕僚长

Again, like a you get a coordinator agent that's in the cloud It has its own computer and all it really does is like it's a manager of agents It's like your executive chef, right your your chief of staff It doesn't do the work itself It delegates and orchestrates and manages the work of other sub agents to you know That report to your chief your chief, uh, of staff and it basically is responsible for driving the work forward and

managing things and passing context to them So if you get a sudden burst of issues, let's say you get 30 issues at once in one payload or something or very quickly The coordinator agent can figure it out and yeah, exactly It gets like, uh, you know 30 the 30 or so payloads and spawns a sub agent or a single coordinator agent It can actually do a bunch of different topologies of agents and it will sort of figure out the best way to

uh, you know efficiently distribute the tasks to your team of agents um So I use cursor projects a lot and I also use grok bot a lot and Cursor projects are my inner loop and grok bot is my outer loop grok bot takes all the context external context Gives it to the projects because it can actually just send messages to those projects Right, you don't even have to open cursor. You can just tell your grok bot. Okay, create a project, right for these series of tasks

Because they're all related, right? Maybe as an example, you know, you've had a A big burst of issues that are all about performance, right? Your app is slow And they're all connected, right? Maybe some of them even have a similar fix Right, but and you can certainly go off and just spawn one agent per task But then you've lost that sort of thread between them, right?And and you may duplicate work or you may not really think about the higher level problem

You know, sometimes when you you solve bugs, you know, it helps to have multiple bug reports that are are slightly different Because it helps you really, you know, zoom out and see actually, you know the problem When I looked at this one report, I thought the bug was here But actually when when I see the other multitude of bugs is actually up here Yeah, got you. So that's why you have so many agents in that loop then, right? Because it's not just you have

Like you have a bug report comes in you spawn a single agent to look at that bug report That that single agent will be duplicating work with other Um other agents, right? Because if there are multiple bug reports coming in through the same thing that can be duplicated work Yeah, fascinating That's really fascinating. Okay. And so this just this endless series of triggers I'm coming from real users reporting real reports

### 园艺：一半的 PR 在加约束

Builds up this sort of and accelerates the factory sort of adds more orders in Other than bug reports, are there any other sources that you use for like, um accelerating for pushing these prs?Uh, well, funnily enough, it's some of it comes from uh, reading the code too. So I guess I have sort of, uh Well, it's so To clarify that, you know, the 2,500 prs. They're not obviously like 2,500 features All right, they are a lot of the work actually is spent on

gardening like another term that I really love where So I guess this is more important when you have a big team of engineers human engineers that you work with where And also this goes back a little bit to while talking about with the environment You know setting up a really good environment doesn't just help you and your agents, but everybody on your team, right?Think of a new hire who doesn't have a lot of context on all of your engineering practices joining your your team

And if you have a really good environment, they can be productive from day one, right?They can they don't have to like, you know, make open a bunch of low quality prs. They can start You know, they can start just turning out really good code And uh, yeah, I think I sort of lost my train of thought I've got a I've got a follow-up, which is what's what are the mechanics of like triggering like how when when do you trigger a

A agent to go and look at the code, right? Because some people might say Well, let's just do that every hour or something or like on a cron job or what's oh, yeah Yeah, I saw some of your recent tweets as well about like, you know, the some of the tweets you've been doing which are great for Senapa's routines uh I have some routines like that as well so one of them is Like looking through

Another simple example is, you know, react has a lot of foot guns so As I'm sure you're aware and so I have an agent that's just constantly looking for bad patterns and The interesting thing about that one is that I don't actually tell it to fix the issue first I tell it to append it to a document And then every couple of days I look at it and I say actually these are all the same thing You know, and so that gives me, you know, you almost want like a buffer a cue

sometimes that's actually more effective than Just spawning off a couple like a lot of sub agents to fix every single thing because when you are in kind of pure execution mode and just trying to like You know, uh, you know execute on the orders that are coming in very fast You sometimes miss the big picture So sometimes having a buffer forces you to think about the big picture because you you you have these artifacts and things that you can look at as a human

and sort of Use your own human judgment to or I guess you can use an agent to do that as well but you give the agent and yourself a way to Identify patterns right that you might otherwise miss if you're just Only solving each bug at a time And that's also really the benefit of having something like a chief of staff agent is uh, it can see the forest right In addition to actually doing the execution Fascinating I mean

### 验收：抽样本，不逐盘尝

My brain is exploding a bit there with the sort of chief of staff of the software factory I might have to change some of the course that i'm filming next week. That's a All right, let's talk about let's talk about review right because this is the reply that you get You know is did you read did you taste all?2,500 of those dishes as they swept past you and I assume the answer is a variety as a version of no Yeah, I think you you you don't want to be in a position where you're not tasting your food ever again

But you also, you know for scale you cannot be tasting every single dish that comes out of your kitchen Especially if you have multiple restaurants, so it becomes more about Sampling right and thinking about the processes In the same way that you know if I guess maybe this is where the the factory Analogy is a bit more apt is you know as a quality supervisor on a factory You can't look at every single item you sample right you take you you you go in there

Every day and you look at the quality of the pull requests you look at the code that the agents are writing and you scrutinize it very rigorously and you Think about all the inefficiencies the bad patterns that the agents are doing And then you think about how to course correct the environment right not not that single agent Because if maybe if it was a one-off incident, it's fine. You know that maybe there's nothing to fix there

But if you actually notice that multiple agents are are having the same issue right there taking the same shortcut They're they're propagating the same work around everywhere That's a sign that you should go off and think about how to Amend your kitchen or your factory right like thinking about your skills your constraints your lints your type systems and Setting or adjusting it so that that problem doesn't happen again

> **思考一下｜从单个 bug 到系统性约束**
>
> 一个 agent 走捷径是个案，多个 agent 走同一条捷径就是环境问题。抽样看的不是这一份 PR，是模式。
>
> **可以追问**：你上一次因为「好几个 agent 都这样」而改规则，是什么时候？
>
> **可延展方向**：把每周抽样看到的问题按「个案 / 模式 / 结构缺陷」分类，只有后两类值得动环境。

And when you do that enough times then you get to a place where the code basis again like the environment is So constrained and so it guides you so well that you can just You can just step away. All right, that's the dream and I'll I'll definitely say it Um, it's very hard to get to this point I don't want to sell this as like, you know something that you can just do easily by using psac like it takes a lot of time and effort to think about your code and where you see your agents

failing and thinking very thoughtfully intentionally and Setting up guardrails and constraints so that they Do the right thing by default and you're not Like if to go back to the software factory analogy, this isn't a dark factory, right? This the lights are wrong It kind of is. Yeah, actually is it? Yeah. Well, it's dark in the sense that so um, it's dark in the sense that Well, I think if my agents are Merging their own pro requests. It's sort of become dark where I go to sleep by my agents and I'll work 24/7

### 黑灯工厂与全自动验证

Uh, I have I have the equivalent of like more than 10 chiefs of staff, right each working on a different area like For example, I have one that's working on performance of the grog bot desktop app. I have one that's working on Uh, fixing bugs that uses report. I have one that's exploring Rewriting it in a different language just for fun. You know, like what if what if you know, just reimagining what what it would be If it was like a native app, it's just a toy

um But the idea is like, yeah, I uh, I when you spend the time setting up your environment I've gotten to a point where I review the pull request after it's landed All right, I tell my agents full autopilot is something that you can do in in p-sac And that will trigger off this very intense rigorous verification loop where it'll spawn a bunch Of verifier agents for every pull request and it will fuzz right Fuzzing meaning that it will actually run the application

it's going to click around and try to use it like a real human look for regression look for bugs in your implementation and Um, it will try to find issues with the thing and then it will fix it itself It'll do that again and eventually get the pr to a state where it can land Uh, so it does it does it is quite token intensive. You can tune this of course Uh, so you know instead of like 10 verifier agents you might do like one

Right or you know, just tell the agent to verify it's on work But yeah, the key thing is the verification part is really the key piece that gives me a lot of confidence That I guess verification plus the environment It's these the combination of these two things that allow me to step away and say agents go off and merge your thing I'll review it in the morning by looking at my commit history And if I see problems I go in course correct

All right, and I'll go in revert or modify add new lit rules and whatever um So it does it does take time to get to that point But once you get it, oh, it's so it feels so magical Uh, I I tell people like I'm sleeping so much better now Because you know it took it The very first day I turned on that sort of dark factory was very scary because I was like, oh What if I cause a step right? What if I break something overnight?

Uh, and it took a lot of it took a lot of Bravery I think to do that but somehow I did it and now I'm in a place where my agents are Merging their own code while I say it sounds like I think it's dark in that sense. Yes, it's dark sometimes, right?You do sometimes that's true. That's true. That's because I think of a dark factory is like almost like If you take the original definition of kapathi's vibe coding, right?

Which is the code almost doesn't exist. You forget the code might be a thing I think your approach is totally different from that Which is that code and the environment is essential and if the code and the environment are bad Then you will get bad outputs garbage in garbage out. So I yeah, I think I think this is uh, this is a different thing. It's like you know The I don't know. Maybe there's a dimmer switch or something right like, you know, some parts of the battery is dark

Some parts where this is why that maybe the the kitchen Is a better analogy the restaurant because you know, even as a as a as a As a restaurant restaurant tour You still might go to your restaurants every now and then take take a peek in taste of food, right?Yeah, I think that's the idea of sampling instead of blocking. I think it's really important I think what would you say to people who are in?I guess you're obviously in a pretty security conscious environment where you're working very security conscious

### 单向门怎么办

um Maybe there are folks working in like um medical applications or law or finance or something I think if they're like some prs are kind of like two-way doors Which is you can merge it and then revert it, right?It's cheating to move back through but there are some prs that are one-way doors, right?That will cause data loss of some kind that will Do something that can't be easily walked back How do you deal with situations where most of your prs? Let's say are one-way doors

Like is this something you just wouldn't recommend or like what do you think?Yeah, I think that's a really good question. I think that It all comes back to me to the quality of the verification that you're able to uh Get out of your agents and I think for domains where the work is verifiable This is easier, right and the the one-way doors become two-way doors in a sense But I guess I don't know if you're working on something that is like

extremely It's very hard to verify Programmatically, then I think yeah, you're definitely in a position where it's very hard to get to that point um So I do think like yeah verifiability of the domain is an important aspect to be able to do this Um and software engineering is just one of those things where it's quite verifiable in in a lot of cases Maybe not totally You know like other domains like mathematics. I think are another example of

Not all of it, of course, but some aspects of mathematics can be verifiable If you write a proof for example, um, and so Yeah, I think it's a great question that I don't really have the answer to and I think that this is I mean the industry Us as engineers will have to figure out is you know my sort of Hope and prediction for the future is that we'll see more and more interesting new Agent oriented programming languages and one of the most fascinating ones that I've seen so far is this one called bend

B E N D bend and that language is one where it kind of marries Programming with proofs Right, there used to be a time You know where you actually had to write your proofs in a different language And proofs by the way for those who aren't familiar is this idea of That you can sort of formally verify that some code is correct mathematically Right, especially if you've written your code in a very functional programming way

Uh, but for the longest time you had to do that in a separate language like lean or tla plus or I'm blanking on some of the other other examples, but Uh, you like languages like that where you would construct the mathematical proof and then Use a solver essentially to to check all right that that you've covered all the cases You don't have like a race condition or or whatever so yeah, I think Trying to sum up the question

I think yeah, if you are in a position where you can figure out how Your agents can truly verify the work in a way that gives you confidence you can actually you know Have the pr is merged because if it compiles right if it if the proofs show you that it's correct Then why wouldn't you just merge it?um But of course, yeah, not all domains are verifiable Yeah, it's a tough one um Okay, I think we've got to think about wrapping up because we are nearly on the hour. Have you got something after this?

### 两套 skill 怎么合

I mean, I've got something to give my son dinner, but I can go a bit longer after you. Okay, let's go five minutes longer then. Um, I think I just want to have one more question which is I think I want to ask how You see p-stack And how you see skills in general like in terms of We talked about this before we went on air, which is like people think of it is like my skills versus your skills and How do you combine frameworks together? How do you use p-stack with my stuff?

Like what should you take from each one and because I think I see skills as sort of Just derived from process basically like they're just processes turned into words and I would love to know How you recommend people take p-stack and take my stuff as well and turn it into their own processes I think you shared a tip actually the today that I thought was actually very relevant Which is this idea that you go off and look at your previous transcripts

right and you sort of mine for information of you know your own Look through your own your own prompts right to the agents where you correct them where you have to constantly intervene and You know take that higher level learning and turn that into a reusable skill right so that agents stop repeating that mistake I think that P-stack and your skills are very complementary. I totally agree with you that they're like a skill is really much just process

I mean it's just at the end of the day skill is just English or or language. It's just marked down um, and I think you can you can definitely weave them Combine them in a way that makes sense to you But I do think that uh, everyone should have their own set of knives All right, I keep going back to the the cooking analogy, but it's so apt because like you know every chef When they go to a different job right when they go to a different restaurant

They carry they bring their knives with them the tools go with them right and so trust to me is really about trust in your own tools and When you spend the time sharpening them and understanding them really really well You can do great things and everybody's skills and tool set is going to look different You know, someone might find a lot of success combining, you know, like your grill me with dogs Or we find your skill with some of the execution skills in P-stack as an example

Some people might use more of your skills. Some people might use more of my skills I think at the end of the day it really just comes back to How much do you trust?You know me and Matt right like if you if you trust us both of course use our skills But I also encourage you to you know look at your own transcripts Tell the agent to look through, you know, some of the all of the patterns that you've used the the times you've had to intervene

You know suggest turning them into lit rules or new skills, right?the the past chance I often say is like a a treasure trove of context because the you know, it's it's like The process materialized right like it's the real process not an abstract idea in your head. It's the actual thing Right and you can actually see how it happened in practice and extract so much information from that And there's so much so that I actually turn I have a skill in P-stack called recall, which is exactly that

### 会话记录是富矿

um, where this was a pattern where You know, I was working in I was working on a similar problem So specifically I was working on virtualization for the cursor application and there were a lot of bugs And so, you know, every time I started a new chat I was like, oh, there's there's so much good context from the last one though You know, I want to bring it over to the new chat. How do I do that? And that's where the transcript of

you know, looking at the past transcript came about and then recall was just a way for me to Collapse collapse and compress that workflow into a skill so that I didn't have to just say I didn't have to write a long essay every time go look at all these chats, right and you know the blah blah blah So I I largely think of skills, especially as agents get more capable as really encoding workflows You know skills from last year were really more about like almost like implementation details like here are the exact script

Commands, you know, you should use right? I think with the latest models You can just delete those parts and just really focus on the workflow, right?Until it's more the skill becomes more like a series of steps A series of your process And I think over time we'll see that skills get smaller and smaller, you know more compact um and Yeah, they're very very compatible or you can you you know, if you want why not read our skills, right and come and combine them

In your of your own right combine wayfinder with potato mode and make your own custom mode, right like skills are The thing I love about skills are that is are that they're so malleable You can do anything you want. It's just language Absolutely, there's nothing magical in them, right? They're just words and exactly if there is any magic in them it's just the words chosen and the phrases used and The thinking that's been done to turn those like take abstract process and turn them into language

And once that thinking has been done, then it's just there. It's available. It's on the surface and you just nick it um Lauren, thank you so much. It's been glorious. Yeah, this has been super fun. I really really enjoyed talking to you Hopefully and we can do it again. I'd love to do again. Yeah, I'd love to do again. Absolutely. Um, yeah, we'll check in in 1883. Yeah Let's do it Part two. Well, thanks so much. I'm going to close the stream here

### 结尾

Laura and I will chat a little bit and stay here, but thank you guys so much for watching

## 综合解读

这条访谈的主线是信任怎么被建起来。Lauren 先说手动微管理一个 agent 有多累，再说验证技能让她第一次放手。验证之外还要环境：一种做法一个位置，能写成规则的就别留给人记。两样东西合起来，她才敢让 agent 自己合并代码。规模再往上，靠的是内外循环。GrokBot 把 Slack、X、邮件里的问题送进 Cursor projects。协调 agent 再分给 sub agent。最后人退回抽样验收，看模式而不是看每一行。

成立前提有三类。第一，领域要可验证。软件比多数领域好验证，所以她能走到全自动；不可验证的领域，她自己也没有答案。第二，代码库要统一。功能目录、lint、类型、CI，缺一样约束就落不下去。第三，问题来源要能接进流程。Slack、issue、邮件得有入口，否则人还得当搬运工。

片中数字都来自自述。每月约 2,500 个 PR，平均一天 80 个。十几个幕僚长。全自动验证对每个 PR 派一队验证 agent。2,500 个 PR 里很多是园艺工作。这些没有第三方核验。

边界值得单独看。她反复说这套办法的前提是可验证性。单向门多的领域，验证强度要更高，或者干脆退回逐项审。她也不认领「黑灯工厂」这个标签，因为代码和环境仍然是核心，环境差输出就差。她仍然每天抽样看 PR，仍然亲自加规则。

可迁移的素材有五个。先建验证，再谈放手。把确定性步骤固化成 CLI。把重复错误写成 lint、类型或结构。把外部问题源接进内循环。用抽样加规则替代逐行评审。
