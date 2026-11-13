import RiseChars from '../components/RiseChars.jsx'
import '../styles/home.css'

const titleSegments = [
  { text: '把需求说清楚。', bold: true },
  { text: '剩下的交给我们。' },
]

export default function HomePage() {
  return (
    <main id="main" className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-grid">
          <div>
            <h1
              id="home-title"
              className="home-hero-title"
              aria-label="把需求说清楚。剩下的交给我们。"
              style={{ '--motion-delay': '60ms' }}
            >
              <RiseChars segments={titleSegments} />
            </h1>
            <p
              className="home-hero-lede motion-rise"
              style={{ '--motion-delay': '260ms' }}
            >
              下载一份客户工作区，按三步装好，跟 agent 说一句话就开始。做完把整个文件夹传回来。
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
        style={{ '--motion-delay': '120ms' }}
      >
        <div className="hero-video-placeholder" aria-hidden="true" />
        <div className="hero-video-fade" aria-hidden="true" />
        <div className="hero-video-copy">
          <div className="hero-video-bottom">
            <div>
              <h2
                id="hero-video-title"
                className="hero-video-title motion-rise"
                style={{ '--motion-delay': '420ms' }}
              >
                九个技能，一套规则。
              </h2>
              <p
                className="hero-video-note motion-rise"
                style={{ '--motion-delay': '480ms' }}
              >
                解压到空文件夹，用 dsh 打开就行。
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
    </main>
  )
}
