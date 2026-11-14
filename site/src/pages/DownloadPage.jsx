import { useEffect, useRef, useState } from 'react'
import PageShell from '../components/PageShell.jsx'
import release from '../../../customer-kit/release.json'
import '../styles/download.css'

const downloadHref = encodeURI(`/downloads/${release.file}`)
const size = release.size.toLocaleString('en-US')
const sizeKb = (release.size / 1024).toFixed(1)

export default function DownloadPage() {
  const [copyStatus, setCopyStatus] = useState('')
  const hashRef = useRef(null)
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const showStatus = (text) => {
    setCopyStatus(text)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopyStatus(''), 2400)
  }

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(release.sha256)
      showStatus('已复制')
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
    showStatus(copied ? '已复制' : '已选中，按 Ctrl/⌘ + C 或长按复制')
  }

  return (
    <PageShell
      path="/download"
      title="下载客户工作区"
      lede={
        <>
          解压到空文件夹，用 dsh 打开，
          <span className="download-nowrap">说一句「开始需求澄清」</span>。
        </>
      }
      scaffold={false}
      className="download-page"
    >
      <section className="download-file download-file--stamp" aria-labelledby="download-file-title">
        <div className="download-file-main">
          <h2 id="download-file-title" className="download-filename">
            {release.file}
          </h2>

          <p className="download-device-note">
            这一步要在电脑上做。把本页链接发到电脑上，再下载。
          </p>

          <div className="download-action">
            <a
              className="download-button"
              href={downloadHref}
              download={release.file}
            >
              下载 zip
              <span className="download-button-size" aria-hidden="true">
                {sizeKb} KB
              </span>
            </a>
            <p className="download-action-note">
              没下完时，浏览器会给文件名加一个后缀。
              <span className="download-nowrap">等后缀消失，再解压。</span>
              <span className="download-nowrap">
                下不动？<a href="/tutorial#support">找客服</a>。
              </span>
            </p>
            <a className="download-inline-next" href="/tutorial">
              下好了，按教程装 →
            </a>
          </div>
        </div>

        <div className="download-spec-wrap">
          <dl className="download-spec">
            <div className="download-spec-item">
              <dt>当前版本</dt>
              <dd>{release.version}</dd>
            </div>
            <div className="download-spec-item">
              <dt>日期</dt>
              <dd>{release.date}</dd>
            </div>
            <div className="download-spec-item">
              <dt>大小</dt>
              <dd>
                {size} 字节（{sizeKb} KB）
              </dd>
            </div>
          </dl>

          <p className="download-seal" aria-hidden="true">
            <span className="download-seal-word">已备好</span>
            <span>
              {release.version} · {release.date}
            </span>
          </p>
        </div>
      </section>

      <details className="download-sha">
        <summary>
          SHA256 与校验
          <span className="download-sha-turn" aria-hidden="true" />
          <span className="download-sha-note">客服核对文件用</span>
        </summary>
        <div className="download-sha-body">
          <p>
            SHA256 给客服核对文件用，平时不用管。下载后不放心，可以算一遍，和这里对得上就没坏。
          </p>
          <div className="download-hash-row">
            <code className="download-hash" ref={hashRef}>
              {release.sha256}
            </code>
            <button className="download-copy" type="button" onClick={copyHash}>
              {copyStatus === '已复制' ? '已复制' : '复制 SHA256'}
            </button>
          </div>
          <p className="download-copy-status" role="status" aria-live="polite">
            {copyStatus}
          </p>

          <div className="download-command">
            <p>Mac 在终端里跑：</p>
            <code>{`shasum -a 256 ~/Downloads/${release.file}`}</code>
          </div>
          <div className="download-command">
            <p>Windows 在命令提示符里跑：</p>
            <code>{`certutil -hashfile "%USERPROFILE%\\Downloads\\${release.file}" SHA256`}</code>
          </div>
          <p>
            对不上，先确认下的是最新版，再<a href="/tutorial#support">找客服</a>。
          </p>
        </div>
      </details>

      <section className="download-systems" aria-labelledby="download-systems-title">
        <h2 id="download-systems-title">系统和装法</h2>
        <div className="download-systems-grid">
          <div>
            <p>
              支持 <span className="download-nowrap">macOS（Apple 芯片和 Intel）</span>和{' '}
              <span className="download-nowrap">Windows 64 位</span>。不支持 Linux。
            </p>
            <p className="download-hint">
              不知道 Mac 是哪种芯片：左上角苹果菜单 → 关于本机 → 看「芯片」那一行。
            </p>
            <p className="download-hint">
              不知道 Windows 是不是 64 位：设置 → 系统 → 关于 → 看「系统类型」那一行。
            </p>
          </div>
          <div>
            <p>工作区要用 dsh 打开。dsh 是 DeepSeek 的桌面智能体软件。</p>
            <p className="download-dsh-link">
              <a
                href="https://www.deepseek.com/harness"
                target="_blank"
                rel="noreferrer"
              >
                还没装？去 DeepSeek 官网下载 dsh →
              </a>
            </p>
            <p className="download-hint">
              装不上，或工作区打不开：<a href="/tutorial#support">找客服</a>。
            </p>
          </div>
        </div>
      </section>

      <section className="download-next" aria-labelledby="download-next-title">
        <div>
          <h2 id="download-next-title">下一步</h2>
          <p>按教程走完三步。第一次对话说什么，也写在里面。</p>
        </div>
        <a className="download-next-link" href="/tutorial">
          看教程 →
        </a>
      </section>
    </PageShell>
  )
}
