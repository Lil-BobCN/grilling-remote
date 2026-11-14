import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Rich, useI18n } from '../i18n/index.jsx'
import release from '../../../customer-kit/release.json'
import manifest from '../../../customer-kit/manifest.json'
import '../styles/tutorial.css'

const downloadHref = encodeURI(`/downloads/${release.file}`)
const size = release.size.toLocaleString('en-US')
const sizeKb = (release.size / 1024).toFixed(1)
const dshUrl = 'https://www.deepseek.com/harness'

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

function CopyButton({ text, label }) {
  const { copy } = useI18n()
  const common = copy.tutorial.common
  const [status, setStatus] = useState('')
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const copyText = async () => {
    let ok = false

    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      ok = fallbackCopy(text)
    }

    setStatus(ok ? common.copied : common.copyFailed)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setStatus(''), 2600)
  }

  return (
    <span className="tutorial-copy-wrap">
      <button className="tutorial-copy" type="button" onClick={copyText}>
        {label || common.copySentence}
      </button>
      <span className="tutorial-copy-status" role="status" aria-live="polite">
        {status}
      </span>
    </span>
  )
}

function StepHead({ n, label, id, title, lead }) {
  const { copy } = useI18n()
  const common = copy.tutorial.common

  return (
    <header className="tutorial-step-head">
      <span className="tutorial-step-num" aria-hidden="true">
        {n}
      </span>
      <div>
        <h2 id={id} className="tutorial-step-title">
          <span className="sr-only">
            {label}
            {common.labelSuffix}
          </span>
          {title}
        </h2>
        <p className="tutorial-step-lede">{lead}</p>
      </div>
    </header>
  )
}

function Stuck({ text, shot }) {
  const { copy } = useI18n()
  const common = copy.tutorial.common

  return (
    <aside className="tutorial-stuck" aria-label={common.stuckAria}>
      <div>
        <p className="tutorial-stuck-title">{common.stuckTitle}</p>
        <p className="tutorial-script">
          {text}
          <CopyButton text={text} />
        </p>
        <p className="tutorial-stuck-shot">{shot}</p>
      </div>
      <a className="tutorial-stuck-go" href="/help">
        {common.stuckLink}
      </a>
    </aside>
  )
}

function NextStep({ href, n, label }) {
  const { copy } = useI18n()

  return (
    <p className="tutorial-next">
      <span>{copy.tutorial.common.next}</span>
      <a href={href}>
        {n} {label} →
      </a>
    </p>
  )
}

export default function TutorialPage() {
  const { copy } = useI18n()
  const tutorial = copy.tutorial
  const common = tutorial.common
  const t = tutorial.steps
  const hero = tutorial.hero

  const sections = useMemo(
    () => [
      {
        id: 'step-1',
        n: '01',
        label: tutorial.sectionLabels['step-1'],
        phase: 'install',
        band: 'paper',
      },
      {
        id: 'step-2',
        n: '02',
        label: tutorial.sectionLabels['step-2'],
        phase: 'install',
        band: 'warm',
      },
      {
        id: 'step-3',
        n: '03',
        label: tutorial.sectionLabels['step-3'],
        phase: 'install',
        band: 'paper',
      },
      {
        id: 'first-chat',
        n: '04',
        label: tutorial.sectionLabels['first-chat'],
        phase: 'chat',
        band: 'mist',
      },
      {
        id: 'upload',
        n: '05',
        label: tutorial.sectionLabels.upload,
        phase: 'handoff',
        band: 'paper',
      },
    ],
    [tutorial.sectionLabels],
  )

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
  }, [sections])

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

  const step1 = t['step-1']
  const step2 = t['step-2']
  const step3 = t['step-3']
  const firstChat = t['first-chat']
  const uploadStep = t.upload

  return (
    <main id="main" className="page tutorial-page">
      <header className="tutorial-hero" data-reveal>
        <div className="tutorial-hero-main">
          <h1 className="tutorial-title">
            <Rich parts={hero.title} />
          </h1>
          <p className="tutorial-lede">{hero.lede}</p>

          <div className="tutorial-actions">
            <a
              className="tutorial-button"
              href={downloadHref}
              download={release.file}
            >
              {hero.downloadButton}
              <span className="tutorial-button-note">{sizeKb} KB</span>
            </a>
            <a
              className="tutorial-alt-action"
              href={dshUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Rich parts={hero.dshButton} />
            </a>
          </div>

          <p className="tutorial-hero-meta">{hero.meta}</p>
        </div>

        <aside className="tutorial-needs" aria-labelledby="needs-title">
          <h2 id="needs-title">{hero.needsTitle}</h2>
          <ol>
            <li>
              <span className="tutorial-need-num" aria-hidden="true">
                1
              </span>
              <div>
                <b>{hero.needs[0].title}</b>
                <p>{hero.needs[0].body}</p>
              </div>
            </li>
            <li>
              <span className="tutorial-need-num" aria-hidden="true">
                2
              </span>
              <div>
                <b>{hero.needs[1].title(release.version)}</b>
                <p>
                  {hero.needs[1].body(sizeKb, manifest.skills.length)}
                </p>
              </div>
            </li>
            <li>
              <span className="tutorial-need-num" aria-hidden="true">
                3
              </span>
              <div>
                <b>{hero.needs[2].title}</b>
                <p>{hero.needs[2].body}</p>
              </div>
            </li>
          </ol>
          <p className="tutorial-needs-foot">{hero.needsFoot}</p>
        </aside>
      </header>

      <p className="tutorial-alt-route" data-reveal>
        <Rich parts={hero.altRoute} />
      </p>

      <div className="tutorial-layout">
        <nav
          className="tutorial-rail"
          aria-label={tutorial.railTitle}
          data-band={railBands[sections[0].id]}
        >
          <p className="tutorial-rail-title">{tutorial.railTitle}</p>
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
              label={step1.label}
              id="step-1-title"
              title={step1.title}
              lead={step1.lead}
            />

            <ol className="tutorial-substeps">
              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3>{step1.subs[0].title}</h3>
                  <p>{step1.subs[0].body}</p>

                  <dl className="tutorial-file-table">
                    {step1.subs[0].table.map((row) => (
                      <div key={row.platform}>
                        <dt>{row.platform}</dt>
                        <dd>{row.file}</dd>
                      </div>
                    ))}
                  </dl>

                  <p className="tutorial-hint">{step1.subs[0].hint}</p>
                  <p>{step1.subs[0].body2}</p>

                  <a
                    className="tutorial-inline-action"
                    href={dshUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {step1.subs[0].link}
                  </a>
                </div>
              </li>

              <li>
                <span className="tutorial-sub-num" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3>{step1.subs[1].title}</h3>
                  <p>
                    {step1.subs[1].body(manifest.skills.length)}
                  </p>

                  <p className="tutorial-file-meta">
                    {common.fileMeta(
                      release.file,
                      size,
                      sizeKb,
                      release.version,
                      release.date,
                    )}
                  </p>

                  <a
                    className="tutorial-button tutorial-button-small"
                    href={downloadHref}
                    download={release.file}
                  >
                    {common.downloadFile(release.file)}
                  </a>

                  <p className="tutorial-hint">{step1.subs[1].hint1}</p>
                  <p className="tutorial-hint">{step1.subs[1].hint2}</p>

                  <a className="tutorial-inline-action" href="/download">
                    {step1.subs[1].link}
                  </a>
                </div>
              </li>
            </ol>

            <div className="tutorial-check">
              <p className="tutorial-check-title">{common.checkTitle}</p>
              <ul>
                {step1.checkItems(release.file).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <Stuck text={step1.stuck.text} shot={step1.stuck.shot} />
            <NextStep
              href="#step-2"
              n={step1.next.n}
              label={step1.next.label}
            />
          </section>

          <section
            className="tutorial-step"
            data-phase="install"
            data-band="warm"
            data-reveal
            id="step-2"
            aria-labelledby="step-2-title"
          >
            <StepHead
              n="02"
              label={step2.label}
              id="step-2-title"
              title={step2.title}
              lead={step2.lead}
            />

            <ol className="tutorial-substeps">
              {step2.subs.map((sub, index) => (
                <li key={sub.title}>
                  <span className="tutorial-sub-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{sub.title}</h3>
                    {Array.isArray(sub.body) ? (
                      <p>
                        <Rich parts={sub.body} />
                      </p>
                    ) : (
                      <p>{sub.body}</p>
                    )}
                    {sub.hint ? (
                      <p className="tutorial-hint">{sub.hint}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            <div className="tutorial-specimen">
              <p className="tutorial-specimen-title">{step2.specimenTitle}</p>
              <pre className="tutorial-tree">
                <span>{step2.tree[0]}</span>
                {step2.tree[1]}
                <b className="tutorial-tree-hit">{step2.tree[2]}</b>
                {step2.tree[3]}
              </pre>
              <p className="tutorial-caption">
                <Rich parts={step2.caption} />
              </p>
            </div>

            {step2.notes.map((note) => (
              <div className="tutorial-note" key={note.title}>
                <b>{note.title}</b>
                <p>{note.body}</p>
              </div>
            ))}

            <Stuck text={step2.stuck.text} shot={step2.stuck.shot} />
            <NextStep
              href="#step-3"
              n={step2.next.n}
              label={step2.next.label}
            />
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
              label={step3.label}
              id="step-3-title"
              title={step3.title}
              lead={step3.lead}
            />

            <ol className="tutorial-substeps">
              {step3.subs.map((sub, index) => (
                <li key={sub.title}>
                  <span className="tutorial-sub-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{sub.title}</h3>
                    <p>{sub.body}</p>

                    {sub.phrase ? (
                      <div className="tutorial-copybox">
                        <code lang="zh-CN">{sub.phrase}</code>
                        <CopyButton text={sub.phrase} label={common.copy} />
                      </div>
                    ) : null}

                    {sub.hint ? (
                      <p className="tutorial-hint">{sub.hint}</p>
                    ) : null}
                    {sub.body2 ? <p>{sub.body2}</p> : null}
                  </div>
                </li>
              ))}
            </ol>

            <div className="tutorial-specimen tutorial-dsh">
              <p className="tutorial-specimen-title">{step3.specimenTitle}</p>
              <p className="tutorial-dsh-path">{step3.specimenPath}</p>
              <p className="tutorial-dsh-user" lang="zh-CN">
                {step3.specimenUser}
              </p>
              <blockquote className="tutorial-quote">
                {step3.specimenQuote}
              </blockquote>
              <p className="tutorial-caption">{step3.specimenCaption}</p>
            </div>

            <div className="tutorial-note">
              <b>{step3.note.title}</b>
              <p>{step3.note.body}</p>
            </div>

            <h3 className="tutorial-subheading">{step3.rulesTitle}</h3>
            <ol className="tutorial-rules">
              {step3.rules.map((rule, index) => (
                <li key={index}>
                  <span className="tutorial-rule-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="tutorial-rule-text">
                    <Rich parts={rule} />
                  </span>
                </li>
              ))}
            </ol>

            <Stuck text={step3.stuck.text} shot={step3.stuck.shot} />
            <NextStep
              href="#first-chat"
              n={step3.next.n}
              label={step3.next.label}
            />
          </section>

          <section
            className="tutorial-step tutorial-chat"
            data-phase="chat"
            data-band="mist"
            id="first-chat"
            aria-labelledby="first-chat-title"
            data-reveal
          >
            <StepHead
              n="04"
              label={firstChat.label}
              id="first-chat-title"
              title={firstChat.title}
              lead={firstChat.lead}
            />

            {firstChat.notes.map((note) => (
              <div className="tutorial-note" key={note.title}>
                <b>{note.title}</b>
                <p>{note.body}</p>
              </div>
            ))}

            <div className="tutorial-three">
              <p className="tutorial-three-title">{firstChat.threeTitle}</p>
              <div className="tutorial-three-row">
                {firstChat.threeRows.map((row, index) => (
                  <Fragment key={row}>
                    <span>
                      <b>{index + 1}</b>
                      {row}
                    </span>
                    {index < firstChat.threeRows.length - 1 ? (
                      <span className="tutorial-arrow" aria-hidden="true">
                        →
                      </span>
                    ) : null}
                  </Fragment>
                ))}
              </div>
              <p className="tutorial-three-note">{firstChat.threeNote}</p>
            </div>

            <ol className="tutorial-chat-steps">
              {firstChat.chatSteps.map((step, index) => (
                <li className="tutorial-chat-step" key={step.title}>
                  <span className="tutorial-chat-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>

                    {step.quote ? (
                      Array.isArray(step.quote) ? (
                        <blockquote className="tutorial-quote">
                          {step.quote.map((paragraph) => (
                            <p key={paragraph}>{paragraph}</p>
                          ))}
                        </blockquote>
                      ) : (
                        <blockquote className="tutorial-quote">
                          {step.quote}
                        </blockquote>
                      )
                    ) : null}

                    {step.branch ? (
                      <div className="tutorial-branch">
                        {step.branch.map((branch) => (
                          <div key={branch.title}>
                            <h4>{branch.title}</h4>
                            <blockquote className="tutorial-quote">
                              {branch.quote}
                            </blockquote>
                            <p>{branch.body}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {step.body2 ? <p>{step.body2}</p> : null}

                    <p className="tutorial-do">
                      <span>{common.doLabel}</span>
                      {step.do}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="tutorial-after">
              <h3>{firstChat.after.title}</h3>
              <p>{firstChat.after.body}</p>
              <p className="tutorial-example-label">
                {firstChat.after.exampleLabel}
              </p>
              <p className="tutorial-example" lang="zh-CN">
                {firstChat.after.example}
              </p>
              <p className="tutorial-caption">{firstChat.after.caption}</p>
              <p>{firstChat.after.body2}</p>
            </div>

            <div className="tutorial-taboos">
              <h3>{firstChat.taboos.title}</h3>
              <p>{firstChat.taboos.lede}</p>
              <ol>
                {firstChat.taboos.items.map((item, index) => (
                  <li key={item[0]}>
                    <span className="tutorial-rule-num" aria-hidden="true">
                      {index + 1}
                    </span>
                    <p>
                      <b>{item[0]}</b>
                      {item[1]}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <blockquote className="tutorial-quote tutorial-progress">
              {firstChat.progressQuote}
            </blockquote>

            <Stuck text={firstChat.stuck.text} shot={firstChat.stuck.shot} />
            <NextStep
              href="#upload"
              n={firstChat.next.n}
              label={firstChat.next.label}
            />
          </section>

          <section
            className="tutorial-step"
            data-phase="handoff"
            data-reveal
            id="upload"
            aria-labelledby="upload-title"
          >
            <StepHead
              n="05"
              label={uploadStep.label}
              id="upload-title"
              title={uploadStep.title}
              lead={uploadStep.lead}
            />

            <ol className="tutorial-substeps">
              {uploadStep.subs.map((sub, index) => (
                <li key={sub.title}>
                  <span className="tutorial-sub-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{sub.title}</h3>
                    <p>{sub.body}</p>
                    {sub.hint ? (
                      <p className="tutorial-hint">
                        <Rich parts={sub.hint} />
                      </p>
                    ) : null}
                    {sub.button ? (
                      <a
                        className="tutorial-button tutorial-button-small"
                        href="/app/upload"
                      >
                        {sub.button}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            <div className="tutorial-note tutorial-note-strong">
              <b>{uploadStep.note}</b>
            </div>

            <p className="tutorial-caption">{uploadStep.caption}</p>

            <Stuck text={uploadStep.stuck.text} shot={uploadStep.stuck.shot} />
          </section>
        </div>
      </div>
    </main>
  )
}
