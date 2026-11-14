import { useEffect, useRef, useState } from 'react'
import release from '../../../customer-kit/release.json'
import manifest from '../../../customer-kit/manifest.json'
import '../styles/tutorial.css'

const downloadHref = encodeURI(`/downloads/${release.file}`)
const size = release.size.toLocaleString('en-US')
const sizeKb = (release.size / 1024).toFixed(1)
const dshUrl = 'https://www.deepseek.com/harness'
const originalSkillsUrl = 'https://github.com/mattpocock/skills'

const sections = [
  { id: 'step-1', n: '01', label: '下载两样东西', phase: 'install', band: 'paper' },
  { id: 'step-2', n: '02', label: '解压到空文件夹', phase: 'install', band: 'paper' },
  { id: 'step-3', n: '03', label: '用 dsh 打开并开口', phase: 'install', band: 'paper' },
  { id: 'first-chat', n: '04', label: '第一次对话', phase: 'chat', band: 'night' },
  { id: 'upload', n: '05', label: '压缩并回传', phase: 'handoff', band: 'night' },
]

function fallbackCopy(text) {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()

  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }

  document.body.removeChild(area)
  return ok
}

function CopyButton({ text, label = '复制这句话' }) {
  const [status, setStatus] = useState('')
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const copy = async () => {
    let ok = false

    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      ok = fallbackCopy(text)
    }

    setStatus(ok ? '已复制' : '没复制上，选中文字手动复制')
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setStatus(''), 2600)
  }

  return (
    <span className="tutorial-copy-wrap">
      <button className="tutorial-copy" type="button" onClick={copy}>
        {label}
      </button>
      <span className="tutorial-copy-status" role="status" aria-live="polite">
        {status}
      </span>
    </span>
  )
}

function StepHead({ n, label, id, title, lead }) {
  return (
    <header className="tutorial-step-head">
      <span className="tutorial-step-num" aria-hidden="true">
        {n}
      </span>
      <div>
        <h2 id={id} className="tutorial-step-title">
          <span className="sr-only">{label}：</span>
          {title}
        </h2>
        <p className="tutorial-step-lede">{lead}</p>
      </div>
    </header>
  )
}

function Stuck({ text, shot }) {
  return (
    <aside className="tutorial-stuck" aria-label="卡在这一步">
      <div>
        <p className="tutorial-stuck-title">卡在这一步？</p>
        <p className="tutorial-script">
          {text}
          <CopyButton text={text} />
        </p>
        <p className="tutorial-stuck-shot">{shot}</p>
      </div>
      <a className="tutorial-stuck-go" href="/help">
        怎么找客服 →
      </a>
    </aside>
  )
}

function NextStep({ href, n, label }) {
  return (
    <p className="tutorial-next">
      <span>下一步</span>
      <a href={href}>
        {n} {label} →
      </a>
    </p>
  )
}

export default function TutorialPage() {
  const [active, setActive] = useState('')
  const railListRef = useRef(null)
  const railSignatureRef = useRef('')
  const [railBands, setRailBands] = useState(() =>
    Object.fromEntries(sections.map((section) => [section.id, 'paper'])),
  )

  useEffect(() => {
    const nodes = sections
      .map((section) => document.getElementById(section.id))
      .filter(Boolean)

    if (!nodes.length) return

    let frame = 0

    const update = () => {
      frame = 0
      const narrow = window.matchMedia('(max-width: 1100px)').matches
      const offset = narrow ? 96 : 160
      let current = ''

      for (const node of nodes) {
        const top = node.getBoundingClientRect().top + window.scrollY
        if (top <= window.scrollY + offset) current = node.id
      }

      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2
      if (atBottom) current = nodes[nodes.length - 1].id

      setActive(current)

      // 目录浮在整段背景上：逐项按自己的位置决定用纸色字还是带上的字。
      const list = railListRef.current
      if (!list) return
      if (window.matchMedia('(max-width: 1100px)').matches) return

      const bandNodes = sections
        .filter((section) => section.band !== 'paper')
        .map((section) => ({
          band: section.band,
          node: document.getElementById(section.id),
        }))
        .filter((entry) => entry.node)

      const next = {}
      sections.forEach((section, index) => {
        const box = list.children[index]?.getBoundingClientRect()
        const probe = box ? box.top + box.height / 2 : -1
        let band = 'paper'

        for (const entry of bandNodes) {
          const rect = entry.node.getBoundingClientRect()
          if (probe >= rect.top && probe < rect.bottom) band = entry.band
        }

        next[section.id] = band
      })

      const signature = sections.map((section) => next[section.id]).join('|')
      if (signature === railSignatureRef.current) return
      railSignatureRef.current = signature
      setRailBands(next)
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!active) return

    const list = railListRef.current
    const link = list?.querySelector(`a[href="#${active}"]`)
    if (!list || !link) return
    if (list.scrollWidth <= list.clientWidth) return

    const listRect = list.getBoundingClientRect()
    const linkRect = link.getBoundingClientRect()
    const target =
      list.scrollLeft +
      linkRect.left -
      listRect.left -
      (listRect.width - linkRect.width) / 2
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    list.scrollTo({
      left: Math.max(0, target),
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [active])

  return (
    <main id="main" className="page tutorial-page">
      <header className="tutorial-hero" data-reveal>
        <div className="tutorial-hero-main">
          <h1 className="tutorial-title">
            三步装好，
            <br />
            <span>开口说你想做什么。</span>
          </h1>
          <p className="tutorial-lede">
            这份教程带你把客户工作区装好，跟 agent 说第一句话。全程不用写代码，做完把整个文件夹传回来。
          </p>

          <div className="tutorial-actions">
            <a
              className="tutorial-button"
              href={downloadHref}
              download={release.file}
            >
              下载客户工作区
              <span className="tutorial-button-note">{sizeKb} KB</span>
            </a>
            <a
              className="tutorial-alt-action"
              href={dshUrl}
              target="_blank"
              rel="noreferrer"
            >
              下载 dsh（DeepSeek Harness）
              <span aria-hidden="true"> ↗</span>
            </a>
          </div>

          <p className="tutorial-hero-meta">
            支持 macOS（Apple 芯片 / Intel）和 Windows 64 位，不支持 Linux。需要一台能联网的电脑。
          </p>
        </div>

        <aside className="tutorial-needs" aria-labelledby="needs-title">
          <h2 id="needs-title">开始之前，你会用到</h2>
          <ol>
            <li>
              <span className="tutorial-need-num" aria-hidden="true">
                1
              </span>
              <div>
                <b>dsh（DeepSeek Harness 桌面版）</b>
                <p>打开工作区、跟你对话的软件。</p>
              </div>
            </li>
            <li>
              <span className="tutorial-need-num" aria-hidden="true">
                2
              </span>
              <div>
                <b>客户工作区 {release.version}</b>
                <p>
                  {sizeKb} KB。{manifest.skills.length} 个技能和规则都在里面，解压就能用。
                </p>
              </div>
            </li>
            <li>
              <span className="tutorial-need-num" aria-hidden="true">
                3
              </span>
              <div>
                <b>一个空文件夹</b>
                <p>名字用日常中文，例如「需求澄清」。</p>
              </div>
            </li>
          </ol>
          <p className="tutorial-needs-foot">
            不用装命令行，不用 GitHub，也不用再装技能。
          </p>
        </aside>
      </header>

      <p className="tutorial-alt-route" data-reveal>
        会写代码，有自己的项目？用{' '}
        <a href={originalSkillsUrl} target="_blank" rel="noreferrer">
          mattpocock/skills 原版技能包
        </a>
        ，自己装进项目。本页只看第 4、5 节。
      </p>

      <div className="tutorial-layout">
        <nav
          className="tutorial-rail"
          aria-label="教程目录"
          data-band={railBands[sections[0].id]}
        >
          <p className="tutorial-rail-title">本页</p>
          <ol ref={railListRef}>
            {sections.map((section) => (
              <li
                key={section.id}
                data-phase={section.phase}
                data-band={railBands[section.id]}
              >
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? 'location' : undefined}
                >
                  <span className="tutorial-rail-num" aria-hidden="true">
                    {section.n}
                  </span>
                  <span>{section.label}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="tutorial-body">
          <section
            className="tutorial-step"
            data-phase="install"
            data-reveal
            id="step-1"
            aria-labelledby="step-1-title"
          >
            <StepHead
              n="01"
              label="第 1 步"
              id="step-1-title"
              title="下载两样东西"
              lead="dsh 是打开工作区的工具，工作区包是给 dsh 读的规则和技能。两样都下好，再往下走。"
            />

            <ol className="tutorial-substeps">
              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3>下载 dsh</h3>
                  <p>到 DeepSeek 官网下载对应系统的安装包，按提示装好。</p>

                  <dl className="tutorial-file-table">
                    <div>
                      <dt>Windows 64 位</dt>
                      <dd>dsh-latest-windows-x64.exe</dd>
                    </div>
                    <div>
                      <dt>Mac · Apple 芯片</dt>
                      <dd>dsh-latest-macos-arm64.dmg</dd>
                    </div>
                    <div>
                      <dt>Mac · Intel 芯片</dt>
                      <dd>dsh-latest-macos-x64.dmg</dd>
                    </div>
                  </dl>

                  <p className="tutorial-hint">
                    不知道 Mac 是哪种芯片：左上角苹果菜单 → 关于本机 → 看「芯片」那一行。
                  </p>
                  <p>
                    装完先打开一次，能看到选择文件夹的界面，就说明装对了。安装时如果系统弹出安全提示，先截图找客服，不要自己关系统保护。
                  </p>

                  <a
                    className="tutorial-inline-action"
                    href={dshUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开 DeepSeek 官网 ↗
                  </a>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3>下载客户工作区</h3>
                  <p>{manifest.skills.length} 个技能、规则和说明都在里面，解压就能用，不用再装配。</p>

                  <p className="tutorial-file-meta">
                    {release.file} · {size} 字节（{sizeKb} KB） ·{' '}
                    {release.version} · {release.date}
                  </p>

                  <a
                    className="tutorial-button tutorial-button-small"
                    href={downloadHref}
                    download={release.file}
                  >
                    下载{release.file}
                  </a>

                  <p className="tutorial-hint">
                    下载完，浏览器的下载列表里应该能看到这个文件名。名字后面多一个 .download，说明还没下完，等一会儿再看。
                  </p>
                  <p className="tutorial-hint">
                    要核对文件有没有坏，下载页里有 SHA256 和命令。平时不用管。
                  </p>

                  <a className="tutorial-inline-action" href="/download">
                    看版本、日期和 SHA256 →
                  </a>
                </div>
              </li>
            </ol>

            <div className="tutorial-check">
              <p className="tutorial-check-title">你会看到</p>
              <ul>
                <li>下载列表里有两个文件：dsh 安装包和{release.file}。</li>
                <li>dsh 打开后，能看到选择文件夹的界面。</li>
              </ul>
            </div>

            <Stuck
              text="我卡在第 1 步，下载或安装 dsh 不顺利。"
              shot="截一张下载页或下载列表的图，一起发。"
            />
            <NextStep href="#step-2" n="02" label="解压到空文件夹" />
          </section>

          <section
            className="tutorial-step"
            data-phase="install"
            data-reveal
            id="step-2"
            aria-labelledby="step-2-title"
          >
            <StepHead
              n="02"
              label="第 2 步"
              id="step-2-title"
              title="解压到一个空文件夹"
              lead="工作区要单独放一个文件夹。以后每次都打开它，进度也存在里面。不要放进已有的代码项目，也不要和别的项目混在一起。"
            />

            <ol className="tutorial-substeps">
              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3>新建一个空文件夹</h3>
                  <p>
                    名字用日常中文，例如「需求澄清」。放在你找得到的地方，桌面或文稿都行。
                  </p>
                  <p className="tutorial-hint">
                    路径里不要有奇怪符号。中文和空格没问题。
                  </p>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3>把 zip 放进去，解压到当前文件夹</h3>
                  <p>
                    Mac：双击 zip，系统会在旁边解压出一份。Windows：右键 zip → 全部解压缩，选这个空文件夹。
                  </p>
                  <p className="tutorial-hint">
                    不要在压缩软件里直接打开里面的文件，要先解压出来。
                  </p>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  3
                </span>
                <div>
                  <h3>看文件列表</h3>
                  <p>
                    解压后打开文件夹，第一层就要能直接看到{' '}
                    <code>AGENTS.md</code>。看到它，就说明位置对了。
                  </p>
                </div>
              </li>
            </ol>

            <div className="tutorial-specimen">
              <p className="tutorial-specimen-title">对的样子</p>
              <pre className="tutorial-tree">
                <span>需求澄清/</span>
                {'\n'}├── <b className="tutorial-tree-hit">AGENTS.md</b>
                {'\n'}├── README.txt
                {'\n'}├── 技能清单.md
                {'\n'}├── docs/
                {'\n'}└── .dsh/
              </pre>
              <p className="tutorial-caption">
                <b>看到 AGENTS.md 就对了。</b>macOS 的 Finder 默认不显示{' '}
                <code>.dsh</code>，按 <code>Cmd + Shift + .</code>{' '}
                可以显示。文件夹里可能还有 LICENSE 和 NOTICE.md，是许可证和来源说明，不用管。以后打开的就是这个「需求澄清」文件夹。
              </p>
            </div>

            <div className="tutorial-note">
              <b>多套了一层？</b>
              <p>
                打开文件夹只看到一个文件夹，看不到 AGENTS.md，说明多套了一层。把里面的东西全部拖出来，放到当前文件夹。
              </p>
            </div>

            <div className="tutorial-note">
              <b>一个文件夹只做一个软件。</b>
              <p>
                要做第二个软件，重新下载一份最新版工作区，解压到新文件夹。这个包不自动升级。
              </p>
            </div>

            <Stuck
              text="我卡在第 2 步，解压后看不到 AGENTS.md。"
              shot="截一张整个文件列表的图，把路径也带上，一起发。不要自己删文件。"
            />
            <NextStep href="#step-3" n="03" label="用 dsh 打开并开口" />
          </section>

          <section
            className="tutorial-step"
            data-phase="install"
            data-reveal
            id="step-3"
            aria-labelledby="step-3-title"
          >
            <StepHead
              n="03"
              label="第 3 步"
              id="step-3-title"
              title="用 dsh 打开，说第一句话"
              lead="文件已经放好。打开 dsh，选中这个文件夹，说一句话就开始。"
            />

            <ol className="tutorial-substeps">
              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3>打开 dsh，选择这个文件夹</h3>
                  <p>
                    在 dsh 里打开「需求澄清」文件夹。窗口里显示的路径，应该就是你刚才那个文件夹。看不到路径，就重新选一次。
                  </p>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3>说第一句话</h3>
                  <p>复制下面这句，或者直接说你想做什么。</p>

                  <div className="tutorial-copybox">
                    <code>开始需求澄清</code>
                    <CopyButton text="开始需求澄清" label="复制" />
                  </div>

                  <p className="tutorial-hint">
                    也可以直接说，例如「我想做一个能预约的理发店小程序」。agent
                    会先判断这件事是大还是小。
                  </p>
                  <p>
                    agent 会先检查三样文件在不在，然后讲一段话，再问你想做什么。一轮列出几个问题，答完一轮再问下一轮。
                  </p>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  3
                </span>
                <div>
                  <h3>弹窗问权限，就点允许</h3>
                  <p>
                    它要写文件时，dsh 会弹窗问。点允许，它才能把进度写进文件夹。
                  </p>
                </div>
              </li>
            </ol>

            <div className="tutorial-specimen tutorial-dsh">
              <p className="tutorial-specimen-title">dsh 里大概是这样</p>
              <p className="tutorial-dsh-path">~/Desktop/需求澄清</p>
              <p className="tutorial-dsh-user">开始需求澄清</p>
              <blockquote className="tutorial-quote">
                我先说说这件事接下来会怎么走。你先说你想做什么。我会判断这件事是大还是小。
              </blockquote>
              <p className="tutorial-caption">
                窗口里的路径就是刚才那个文件夹。发一句「开始需求澄清」，对话就开始了。
              </p>
            </div>

            <div className="tutorial-note">
              <b>如果它说「文件没放对，按官网第 2 步重放」</b>
              <p>
                先回到第 2 步看文件列表。不要重装，截这句话和文件列表找客服。
              </p>
            </div>

            <h3 className="tutorial-subheading">装好之后，记住三件事</h3>
            <ol className="tutorial-rules">
              <li>
                <span className="tutorial-rule-num" aria-hidden="true">
                  1
                </span>
                <span className="tutorial-rule-text">
                  每次都打开这个文件夹。换文件夹，进度就没了。
                </span>
              </li>
              <li>
                <span className="tutorial-rule-num" aria-hidden="true">
                  2
                </span>
                <span className="tutorial-rule-text">
                  进度写在 <code>.scratch/</code> 里。不要自己改，想改什么直接跟
                  agent 说。
                </span>
              </li>
              <li>
                <span className="tutorial-rule-num" aria-hidden="true">
                  3
                </span>
                <span className="tutorial-rule-text">
                  一个文件夹只做一个软件。第二个软件，另开一个文件夹。
                </span>
              </li>
            </ol>

            <Stuck
              text="我卡在第 3 步，dsh 打不开文件夹，或者提示没有权限。"
              shot="截 dsh 窗口和弹窗，一起发。不要反复重装。"
            />
            <NextStep href="#first-chat" n="04" label="第一次对话" />
          </section>

          <section
            className="tutorial-step tutorial-chat"
            data-phase="chat"
            data-band="night"
            id="first-chat"
            aria-labelledby="first-chat-title"
            data-reveal
          >
            <StepHead
              n="04"
              label="第 4 节"
              id="first-chat-title"
              title="第一次对话会遇到什么"
              lead="agent 会先讲一遍接下来怎么走，再请你说想做什么。事情大，这一次会一直走到拆议题、排顺序。事情小，问完就结束。下面按大需求讲，一共六步；小需求在第 3 步分开。"
            />

            <div className="tutorial-note">
              <b>先留意一句话。</b>
              <p>
                第一次打开时，agent 会先检查工作区文件。如果它说「文件没放对，按官网第 2 步重放」，截这句话和文件列表，找客服，不要自己重装。
              </p>
            </div>

            <div className="tutorial-note">
              <b>遇到完全不懂的技术题，直接说「这个我不懂」。</b>
              <p>
                要如实告诉 agent，不然流程会在这里转不下去。它会按推荐答案往下问，并记下来，开工前有人跟你确认。
              </p>
            </div>

            <div className="tutorial-three">
              <p className="tutorial-three-title">
                大需求的六步里，你实际只做三件事
              </p>
              <div className="tutorial-three-row">
                <span>
                  <b>1</b>说你想做什么
                </span>
                <span className="tutorial-arrow" aria-hidden="true">
                  →
                </span>
                <span>
                  <b>2</b>回答 agent 的问题
                </span>
                <span className="tutorial-arrow" aria-hidden="true">
                  →
                </span>
                <span>
                  <b>3</b>看清单，定先做哪张
                </span>
              </div>
              <p className="tutorial-three-note">
                之后每次新对话，只多一件事：把 agent 给的那一行原样复制过去。
              </p>
            </div>

            <ol className="tutorial-chat-steps">
              <li className="tutorial-chat-step">
                <span className="tutorial-chat-num" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3>agent 先讲一遍接下来怎么走</h3>
                  <p>
                    它会告诉你：先说想做什么，它来判断大小；小的当场问清楚，大的拆成几次做。听完你直接说想法就行。
                  </p>
                  <blockquote className="tutorial-quote">
                    <p>我先说说这件事接下来会怎么走。</p>
                    <p>
                      你先说你想做什么。我会判断这件事是大还是小。小的当场问清楚就完事了，之后会交给开发者；任务量大就需要拆分了，拆分成几个小任务，分几次做。
                    </p>
                    <p>你可以开始跟我说你模糊的想法了。</p>
                  </blockquote>
                  <p className="tutorial-do">
                    <span>你要做</span>听它讲完，直接说想法。
                  </p>
                </div>
              </li>

              <li className="tutorial-chat-step">
                <span className="tutorial-chat-num" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3>你说想做什么</h3>
                  <p>
                    用日常的话说，不用想术语，也不用一次说全。agent
                    会从这段话判断事情大还是小。
                  </p>
                  <p className="tutorial-do">
                    <span>你要做</span>说一段你想做的东西。
                  </p>
                </div>
              </li>

              <li className="tutorial-chat-step">
                <span className="tutorial-chat-num" aria-hidden="true">
                  3
                </span>
                <div>
                  <h3>agent 判断大小</h3>
                  <p>它自己判断，不用你选。听完你的想法，它会说走哪条路。</p>

                  <div className="tutorial-branch">
                    <div>
                      <h4>事情小</h4>
                      <blockquote className="tutorial-quote">
                        「这件事不大，今天就能问清楚。问完我整理成一份需求草稿，交给开发去做。」
                      </blockquote>
                      <p>
                        接下来它问几轮，你回答。问完这次对话就结束，没有议题清单。
                      </p>
                    </div>
                    <div>
                      <h4>事情大</h4>
                      <blockquote className="tutorial-quote">
                        「已经确定需要拆分。」
                      </blockquote>
                      <p>
                        接着往下走，把终点定成一句话，再拆成议题。继续看第 4 步。
                      </p>
                    </div>
                  </div>

                  <p className="tutorial-do">
                    <span>你要做</span>听它说走哪条，接着答。
                  </p>
                </div>
              </li>

              <li className="tutorial-chat-step">
                <span className="tutorial-chat-num" aria-hidden="true">
                  4
                </span>
                <div>
                  <h3>把终点定成一句话</h3>
                  <p>
                    agent
                    一轮列几个问题，每个都带推荐答案。你按自己的情况答。它把这些答案收成一句话，就是终点。
                  </p>
                  <blockquote className="tutorial-quote">
                    <p>
                      拆的话，第一步是我跟你把它最后要做成什么样定下来。这就是终点。终点是一句话，比如「顾客在微信上看今天的水果、下单、选到店取还是送货，你在后台改价格和库存」。
                    </p>
                    <p>
                      我问的问题请你自己答，一定要重视，因为问题和问题之间是有逻辑联系的，一步错，后面全跟着错。
                    </p>
                  </blockquote>
                  <p className="tutorial-do">
                    <span>你要做</span>自己答。一轮答不完就分几轮。
                  </p>
                </div>
              </li>

              <li className="tutorial-chat-step">
                <span className="tutorial-chat-num" aria-hidden="true">
                  5
                </span>
                <div>
                  <h3>拆成一张一张议题</h3>
                  <p>
                    终点定下来，agent
                    会先说「终点定了」，再把整件事拆成一张一张议题。一张议题就是一次对话，只定这一件事。
                  </p>
                  <blockquote className="tutorial-quote">
                    「接下来我把它拆成一张一张的议题，一张议题代表一个任务。这些任务都做完，你要的东西就做成了。」
                  </blockquote>
                  <p className="tutorial-do">
                    <span>你要做</span>等它拆完。文件你不用打开，也不用管。
                  </p>
                </div>
              </li>

              <li className="tutorial-chat-step">
                <span className="tutorial-chat-num" aria-hidden="true">
                  6
                </span>
                <div>
                  <h3>看清单，定先做哪张</h3>
                  <p>
                    拆完它把清单给你看：一共几张、每张做什么。顺序由你定。你说哪张先做，它就按你说的排。
                  </p>
                  <blockquote className="tutorial-quote">
                    「拆完我把清单给你看：一共几张、每张做什么、按什么顺序做。哪张要先做，你说，我按你说的排。」
                  </blockquote>
                  <p>
                    每张开头还会写一句，这次是聊、看个样子、动手做，还是我去查。
                  </p>
                  <p className="tutorial-do">
                    <span>你要做</span>看清单，说一句先做哪张。
                  </p>
                </div>
              </li>
            </ol>

            <div className="tutorial-after">
              <h3>之后每次新对话，只复制一行</h3>
              <p>
                定完顺序，agent
                会说一句「议题拆好了，顺序按你定的」，再请你新开一次对话。它给你一行字，原样复制过去，不要改。
              </p>
              <p className="tutorial-example-label">示例</p>
              <p className="tutorial-example">继续：tanxin-yuyue 01 空档怎么放</p>
              <p className="tutorial-caption">
                这是举例。每次的需求名、编号、票名都不一样，以 agent
                给你的那一行为准，不要复制这里的例子。
              </p>
              <p>
                agent
                会自己接上，不用你重新讲一遍。它会先说三句：这件事最后要做成什么、现在走到哪；已经定了几条；下一步做哪张。然后开始。
              </p>
            </div>

            <div className="tutorial-taboos">
              <h3>这个做法最怕的三件事</h3>
              <p>agent 在拆议题前会提前说。记住这三句，后面会顺很多。</p>
              <ol>
                <li>
                  <span className="tutorial-rule-num" aria-hidden="true">
                    1
                  </span>
                  <p>
                    <b>在一张议题里聊另一张的事。</b>
                    想到了就先说一声，我记到那张去，这张先做完。
                  </p>
                </li>
                <li>
                  <span className="tutorial-rule-num" aria-hidden="true">
                    2
                  </span>
                  <p>
                    <b>说着说着拐到别处。</b>
                    拐了就拐了，你照说，我记下来，再拉回来。
                  </p>
                </li>
                <li>
                  <span className="tutorial-rule-num" aria-hidden="true">
                    3
                  </span>
                  <p>
                    <b>在后面的议题里改前面定过的事。</b>
                    要改就说，我去改当初那一张，在地图上记一笔，不在新议题里悄悄改。
                  </p>
                </li>
              </ol>
            </div>

            <blockquote className="tutorial-quote tutorial-progress">
              「进度我写在这个文件夹里，你不用打开，也不用改。想改什么直接跟我说。」
            </blockquote>

            <Stuck
              text="我卡在第 4 步，agent 没有讲开场那段，或者一直说文件没放对。"
              shot="截 agent 说的话和文件列表，一起发。"
            />
            <NextStep href="#upload" n="05" label="压缩并回传" />
          </section>

          <section
            className="tutorial-step"
            data-phase="handoff"
            data-band="night"
            data-reveal
            id="upload"
            aria-labelledby="upload-title"
          >
            <StepHead
              n="05"
              label="第 5 节"
              id="upload-title"
              title="压缩整个文件夹，传回来"
              lead="全部做完，agent 会说「这件事都问完了」，不再推荐下一张票。接下来把整个工作区传回来，剩下的交给我们。"
            />

            <ol className="tutorial-substeps">
              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3>压缩整个文件夹</h3>
                  <p>
                    Mac：右键「需求澄清」文件夹 → 压缩「需求澄清」。Windows：右键文件夹 → 压缩为 ZIP 文件。
                  </p>
                  <p className="tutorial-hint">
                    压缩的是整个文件夹，不是只压 <code>.scratch/</code>。包里要带着{' '}
                    <code>AGENTS.md</code> 和 <code>.scratch/</code>。
                  </p>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3>打开上传页</h3>
                  <p>上传页在账号区，登录后进入。</p>
                  <a
                    className="tutorial-button tutorial-button-small"
                    href="/app/upload"
                  >
                    打开上传页 →
                  </a>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  3
                </span>
                <div>
                  <h3>登录</h3>
                  <p>
                    用我们发给你的邮箱和密码登录。账号由我们开通，密码通过微信发给你。
                  </p>
                  <p className="tutorial-hint">
                    忘了密码，<a href="/help">找客服</a>重设。
                  </p>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  4
                </span>
                <div>
                  <h3>拖入 zip，勾「已问完」</h3>
                  <p>
                    把压缩包拖进上传框，勾上「已问完」。简称和邮箱由账号带出，不用填。
                  </p>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  5
                </span>
                <div>
                  <h3>提交，等我们联系</h3>
                  <p>看到上传成功就结束了。后面由我们处理，不用再操作。</p>
                </div>
              </li>
            </ol>

            <div className="tutorial-note tutorial-note-strong">
              <b>文件夹里的所有文件都会上传，请只放本项目的资料。</b>
            </div>

            <p className="tutorial-caption">
              对话记录不在这个文件夹里，不会跟着上传。整个压缩包控制在 50 MB
              以内。
            </p>

            <Stuck
              text="我卡在第 5 步，压缩包传不上去。"
              shot="截上传页和报错提示，一起发。不要重复传很多次。"
            />
          </section>
        </div>
      </div>
    </main>
  )
}
