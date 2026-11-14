import { useEffect, useRef } from 'react'
import RiseChars from '../components/RiseChars.jsx'
import '../styles/home.css'

const titleSegments = [
  { text: '从一句需求，' },
  { text: '到一套能用的软件。' },
]

const reasons = [
  {
    title: '打开就能用',
    text: '九个技能和一套规则都装好了，不用自己配。',
  },
  {
    title: '文件留在你电脑',
    text: '需求和草稿都在本机；官网只负责发下载包、收成品。',
  },
  {
    title: '卡住有人管',
    text: '教程中每一步都写清了你该看到什么、该怎么做。卡住了，截图发给我们。',
  },
]

const steps = [
  {
    n: '01',
    title: '下载两样',
    text: '工作区 zip 和 dsh 安装包，都下好再继续。',
    check: '你会看到：下载列表里有两个文件',
  },
  {
    n: '02',
    title: '解压到空文件夹',
    text: '右键解压，不要直接在压缩包里打开。',
    check: '你会看到：AGENTS.md 和 .scratch/ 在文件夹里',
  },
  {
    n: '03',
    title: '用 dsh 打开，说一句话',
    text: '选这个文件夹，输入「开始需求澄清」。',
    check: '你会看到：agent 开始问你第一个问题',
  },
]

// 来源：customer-kit/manifest.json。清单页 I-0065 会直接读 manifest。
const skills = [
  { name: 'grilling', summary: '一次问一件事，把模糊的想法问清楚。' },
  { name: 'domain-modeling', summary: '把需求里的词定清楚，写进词表。' },
  { name: 'wayfinder', summary: '把大需求拆成一张张小议题，一次做一张。' },
  { name: 'prototype', summary: '先做个粗糙的样子给你看，边看边改。' },
  { name: 'research', summary: '去查资料，把查到的结论写成文件。' },
  { name: 'wait-what', summary: '你没听懂时，把刚才那段重新讲一遍。' },
  { name: 'next', summary: '看进度，说下一张做哪张，并给出可复制的一行。' },
  { name: 'map-gate', summary: '写结论前查一遍，有没有推翻前面定过的事。' },
  { name: 'wrap-up', summary: '收尾时列出新想法和冲突，核对进度。' },
]

export default function HomePage() {
  const heroRef = useRef(null)

  useEffect(() => {
    const hero = heroRef.current
    if (!hero) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let start = 1
    let last = ''

    const setStretch = (value) => {
      if (value === last) return
      last = value
      hero.style.setProperty('--hero-stretch', value)
    }

    const measure = () => {
      start = Math.max(1, hero.getBoundingClientRect().top + window.scrollY)
    }

    const update = () => {
      frame = 0

      if (reduced.matches) {
        setStretch('1')
        return
      }

      const maxScroll = document.documentElement.scrollHeight - window.innerHeight
      if (maxScroll <= 0) {
        setStretch('1')
        return
      }

      // 页面还没铺满时，先把可滚的距离用完；下半页做出来后按面板顶部收口。
      const end = Math.max(1, Math.min(start, maxScroll))
      const progress = Math.min(1, Math.max(0, window.scrollY / end))
      setStretch(progress.toFixed(4))
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }

    const onResize = () => {
      measure()
      schedule()
    }

    measure()
    update()

    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', onResize)
    reduced.addEventListener('change', onResize)

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', onResize)
      reduced.removeEventListener('change', onResize)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <main id="main" className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-grid">
          <div>
            <h1
              id="home-title"
              className="home-hero-title"
              aria-label="从一句需求，到一套能用的软件。"
              style={{ '--motion-delay': '60ms' }}
            >
              <RiseChars segments={titleSegments} />
            </h1>
            <p
              className="home-hero-lede motion-rise"
              style={{ '--motion-delay': '260ms' }}
            >
              下载客户工作区，按三步装好。
              <br className="home-lede-break" />
              agent 会主动用一套专业方法，把需求问清楚；做完把整个<span className="home-keep">文件夹</span>传回来。
            </p>
          </div>
          <p
            className="home-hero-meta motion-rise"
            style={{ '--motion-delay': '340ms' }}
          >
            客户工作区 v1
            <br />
            41,456 字节 · 2026-11-07
            <br />
            支持 macOS 和 Windows 64 位
          </p>
        </div>
      </section>

      <section
        className="hero-video motion-panel"
        aria-labelledby="hero-video-title"
        data-motion-loop
        ref={heroRef}
        style={{ '--motion-delay': '120ms' }}
      >
        <div className="hero-video-frame">
          <div className="hero-video-placeholder" aria-hidden="true" />
          <div className="hero-video-fade" aria-hidden="true" />
        </div>
        <div className="hero-video-copy">
          <div className="hero-video-bottom">
            <div>
              <h2
                id="hero-video-title"
                className="hero-video-title motion-rise"
                style={{ '--motion-delay': '420ms' }}
              >
                想法完善，落地更快。
              </h2>
              <p
                className="hero-video-note motion-rise"
                style={{ '--motion-delay': '480ms' }}
              >
                九个技能先把需求问透；再用 AI 时代的<span className="home-keep">低成本</span>开发，把想法做出来。
              </p>
            </div>
            <div
              className="hero-video-actions motion-rise"
              style={{ '--motion-delay': '540ms' }}
            >
              <a className="hero-download" href="/download">
                下载客户工作区
              </a>
              <a className="hero-tutorial" href="/tutorial">
                先看教程
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        className="home-intro"
        aria-labelledby="home-intro-title"
      >
        <div className="home-intro-grid">
          <div data-reveal>
            <h2 id="home-intro-title" className="home-section-title">
              你负责说清楚，<br className="home-intro-break" /><span className="home-keep">我们</span>负责做出来。
            </h2>
            <p className="home-section-lede">
              从下载到回传，按教程走就行。
              <br />
              装好工作区，说清需求，传回文件夹。
            </p>
          </div>
          <div className="home-points">
            {reasons.map((reason, index) => (
              <div
                className="home-point"
                key={reason.title}
                data-reveal="row"
                style={{ '--reveal-delay': `${index * 80}ms` }}
              >
                <b>{reason.title}</b>
                <p>{reason.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="home-steps home-steps--night"
        aria-labelledby="home-steps-title"
      >
        <h2
          id="home-steps-title"
          className="home-section-title"
          data-reveal
        >
          三步装好
        </h2>
        <div className="home-step-grid">
          {steps.map((step, index) => (
            <div
              className="home-step"
              key={step.n}
              data-reveal="row"
              style={{ '--reveal-delay': `${index * 110}ms` }}
            >
              <b>{step.n}</b>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <span>{step.check}</span>
            </div>
          ))}
        </div>
      </section>

      <section
        className="home-skills"
        aria-labelledby="home-skills-title"
      >
        <div className="home-skills-grid">
          <div data-reveal>
            <h2 id="home-skills-title" className="home-section-title">
              九个技能，<br />装好就能用。
            </h2>
            <p className="home-section-lede">
              不用学，也不用记名字。agent 会主动帮你判断，选对技能。
            </p>
            <a className="home-skills-link" href="/skills">
              看完整清单 →
            </a>
          </div>
          <ol className="home-skill-list">
            {skills.map((skill, index) => (
              <li
                key={skill.name}
                data-reveal="row"
                style={{ '--reveal-delay': `${Math.min(index * 45, 300)}ms` }}
              >
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span>{skill.name}</span>
                <p>{skill.summary}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        className="home-band"
        aria-labelledby="home-band-title"
      >
        <div className="home-band-grid">
          <div className="home-band-statement" data-reveal>
            <h2 id="home-band-title">
              做完了，<br />传回来。
            </h2>
            <p>整个文件夹压成 zip，登录后传回来。勾上「已问完」，剩下的我们来。</p>
          </div>
          <div
            className="home-band-progress"
            data-reveal
            style={{ '--reveal-delay': '90ms' }}
          >
            <h2>进度随时看。</h2>
            <p>五档状态，走到哪一步都写清楚。不用追着问。</p>
          </div>
          <div
            className="home-band-actions"
            data-reveal
            style={{ '--reveal-delay': '180ms' }}
          >
            <a className="home-band-action" href="/app/upload">
              <span>上传工作区</span>
              <span className="home-band-arrow" aria-hidden="true">→</span>
            </a>
            <a className="home-band-action" href="/app/orders">
              <span>我的订单</span>
              <span className="home-band-arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
