import { useEffect, useRef, useState } from 'react'
import PageShell from '../components/PageShell.jsx'
import { Rich, useI18n } from '../i18n/index.jsx'
import release from '../../../customer-kit/release.json'
import '../styles/download.css'

const downloadHref = encodeURI(`/downloads/${release.file}`)
const size = release.size.toLocaleString('en-US')
const sizeKb = (release.size / 1024).toFixed(1)

export default function DownloadPage() {
  const { copy } = useI18n()
  const d = copy.download
  const [copyState, setCopyState] = useState('')
  const hashRef = useRef(null)
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const showStatus = (state) => {
    setCopyState(state)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopyState(''), 2400)
  }

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(release.sha256)
      showStatus('copied')
      return
    } catch {
      // 本地 http 预览没有 clipboard，退回选中文本
    }

    const hash = hashRef.current
    if (!hash) return

    const range = document.createRange()
    range.selectNodeContents(hash)
    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    selection.addRange(range)
    const copied = document.execCommand('copy')
    showStatus(copied ? 'copied' : 'selected')
  }

  return (
    <PageShell
      path="/download"
      title={d.title}
      lede={<Rich parts={d.lede} />}
      scaffold={false}
      className="download-page"
    >
      <section
        className="download-file download-file--stamp"
        aria-labelledby="download-file-title"
        data-reveal="panel"
      >
        <div className="download-file-main">
          <h2 id="download-file-title" className="download-filename" lang="zh-CN">
            {release.file}
          </h2>

          <p className="download-device-note">{d.deviceNote}</p>

          <div className="download-action">
            <a
              className="download-button"
              href={downloadHref}
              download={release.file}
            >
              {d.button}
              <span className="download-button-size" aria-hidden="true">
                {sizeKb} KB
              </span>
            </a>
            <p className="download-action-note">
              <Rich parts={d.actionNote} />
            </p>
            <a className="download-inline-next" href="/tutorial">
              {d.inlineNext}
            </a>
          </div>
        </div>

        <div className="download-spec-wrap">
          <dl className="download-spec">
            <div
              className="download-spec-item"
              data-reveal="fade"
              style={{ '--reveal-delay': '120ms' }}
            >
              <dt>{d.spec.version}</dt>
              <dd>{release.version}</dd>
            </div>
            <div
              className="download-spec-item"
              data-reveal="fade"
              style={{ '--reveal-delay': '180ms' }}
            >
              <dt>{d.spec.date}</dt>
              <dd>{release.date}</dd>
            </div>
            <div
              className="download-spec-item"
              data-reveal="fade"
              style={{ '--reveal-delay': '240ms' }}
            >
              <dt>{d.spec.size}</dt>
              <dd>{d.size(size, sizeKb)}</dd>
            </div>
          </dl>

          <p className="download-seal" aria-hidden="true">
            <span className="download-seal-word">{d.sealWord}</span>
            <span>
              {release.version} · {release.date}
            </span>
          </p>
        </div>
      </section>

      <details className="download-sha" data-reveal>
        <summary>
          {d.sha.summary}
          <span className="download-sha-turn" aria-hidden="true" />
          <span className="download-sha-note">{d.sha.note}</span>
        </summary>
        <div className="download-sha-body">
          <p>{d.sha.body}</p>
          <div className="download-hash-row">
            <code className="download-hash" ref={hashRef}>
              {release.sha256}
            </code>
            <button className="download-copy" type="button" onClick={copyHash}>
              {copyState === 'copied' ? d.sha.copied : d.sha.copy}
            </button>
          </div>
          <p className="download-copy-status" role="status" aria-live="polite">
            {copyState === 'copied'
              ? d.sha.copied
              : copyState === 'selected'
                ? d.sha.selected
                : ''}
          </p>

          <div className="download-command">
            <p>{d.sha.mac}</p>
            <code>{`shasum -a 256 ~/Downloads/${release.file}`}</code>
          </div>
          <div className="download-command">
            <p>{d.sha.win}</p>
            <code>{`certutil -hashfile "%USERPROFILE%\\Downloads\\${release.file}" SHA256`}</code>
          </div>
          <p>
            <Rich parts={d.sha.mismatch} />
          </p>
        </div>
      </details>

      <section
        className="download-systems"
        aria-labelledby="download-systems-title"
        data-reveal
      >
        <h2 id="download-systems-title">{d.systems.title}</h2>
        <div className="download-systems-grid">
          <div>
            <p>
              <Rich parts={d.systems.body} />
            </p>
            <p className="download-hint">{d.systems.hints[0]}</p>
            <p className="download-hint">{d.systems.hints[1]}</p>
          </div>
          <div>
            <p>{d.systems.dshBody}</p>
            <p className="download-dsh-link">
              <a
                href="https://www.deepseek.com/harness"
                target="_blank"
                rel="noreferrer"
              >
                {d.systems.dshLink}
              </a>
            </p>
            <p className="download-hint">
              <Rich parts={d.systems.dshHint} />
            </p>
          </div>
        </div>
      </section>

      <section
        className="download-steps"
        aria-labelledby="download-steps-title"
        data-reveal
      >
        <h2 id="download-steps-title">{d.steps.title}</h2>
        <div className="download-step-grid">
          {d.steps.items.map((step) => (
            <article className="download-step" key={step.n}>
              <b>{step.n}</b>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {step.check ? (
                <p className="download-step-check">{step.check}</p>
              ) : null}
            </article>
          ))}
        </div>
        <a className="download-steps-link" href="/tutorial">
          {d.steps.link}
        </a>
      </section>

      <section
        className="download-next"
        aria-labelledby="download-next-title"
        data-reveal="panel"
      >
        <div>
          <h2 id="download-next-title">{d.next.title}</h2>
          <p>{d.next.body}</p>
        </div>
        <a className="download-next-link" href="/tutorial">
          {d.next.link}
        </a>
      </section>
    </PageShell>
  )
}
