---
name: prototype
description: Build a throwaway single-file HTML prototype that answers one question for a customer who still does not understand an option. Web version of the mattpocock-skills prototype skill, logic branch only.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

原文在 `factory-skills/clarify/original/prototype.md`，一个字没改。网页上的客户没有仓库，也没有终端。下面的规则取代原文里冲突的部分，没冲突的照原文。

## 走哪个分支

只走 [LOGIC.md](LOGIC.md)：客户点着按钮，看状态怎么变。原文的 UI 分支要往真实页面里加路由，网页上没有这样的页面，所以不用。

读 LOGIC.md 时，第 4 步和第 5 步不做。第 2 步的纯模块也省掉，页面和逻辑写在同一个 `<script>` 里。这个页面用完就丢，不会搬进真实代码。

## 什么时候做

客户在一道题上点了「还是看不懂」。你已经用 wait-what 重讲过一遍，客户仍然没懂。这时才做原型。原型要回答的就是这道题。

## 规则

1. **一个文件，一次写完。** 只用写文件工具，只写 `proto/<slug>.html`，放在当前目录下的 `proto` 目录里。写之前先通读一遍所有文字，错字在写之前改。写完发现错误，用写文件工具整份重写，不要用别的工具。
2. **页头第一行写死这条内容安全策略标签，原样放，不改。**

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
```

3. **不碰网络和存储。** 不写任何 http 或 https 地址。不用 fetch、XMLHttpRequest、WebSocket、外部 script、外部 link、`@import`。不用 localStorage 和 sessionStorage，隔离小窗里没有存储。不提交表单，不开新窗口，不改页面地址。状态放在变量里。
4. **页面顶部写两样。** 一句话问题，就是这个原型要回答什么。一段「我是这样理解的」，写明你定的业务规则。规则是你定的，不要写成客户说过的话。
5. **全部文字用中文，用客户自己的词。** 页面上不出现代码词。
6. **每次点击后，整页的状态都看得见。** 客户点一下，就看到哪里变了。可以加一句「刚刚发生了什么」。
7. **按钮要少。** 选一个参数的按钮，加几个剧本按钮，够了。剧本从最容易看懂的情况开始，再给一个容易出错的情况。
8. **用完即丢，状态只在内存，不抛光。** 不写测试，不做出错处理，不留扩展位，不用框架。
9. **有模板就用模板。** 会话目录里有 `templates/` 且有合适的，复制它的结构改参数，不从零写。客户说「都不像」，才从零生成。
10. **页面尽量小。** 目标 8 KB 以内，因为客户在等，生成越长越慢。这个上限是推断，没验。
11. **回答只写一行：文件路径。** 要补充的假设写在页面顶部，不写在回答里。
12. **不提问，不等回复。** 信息不够，就在页面顶部写明你的假设，然后做完。
