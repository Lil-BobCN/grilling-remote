import { useEffect, useRef } from 'react'
import RiseChars from '../components/RiseChars.jsx'
import { Rich, skillText, useI18n } from '../i18n/index.jsx'
import manifest from '../../../customer-kit/manifest.json'
import release from '../../../customer-kit/release.json'
import '../styles/home.css'

// 来源：customer-kit/manifest.json。清单页 I-0065 也直接读 manifest。
const skills = manifest.skills
const size = release.size.toLocaleString('en-US')

export default function HomePage() {
  const { lang, copy } = useI18n()
  const home = copy.home
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
              aria-label={home.titleAria}
              style={{ '--motion-delay': '60ms' }}
            >
              <RiseChars segments={home.titleSegments} />
            </h1>
            <p
              className="home-hero-lede motion-rise"
              style={{ '--motion-delay': '260ms' }}
            >
              <Rich parts={home.lede} />
            </p>
          </div>
          <p
            className="home-hero-meta motion-rise"
            style={{ '--motion-delay': '340ms' }}
          >
            <Rich parts={home.heroMeta(release, size)} />
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
                {home.videoTitle}
              </h2>
              <p
                className="hero-video-note motion-rise"
                style={{ '--motion-delay': '480ms' }}
              >
                <Rich parts={home.videoNote(manifest.skills.length)} />
              </p>
            </div>
            <div
              className="hero-video-actions motion-rise"
              style={{ '--motion-delay': '540ms' }}
            >
              <a className="hero-download" href="/download">
                {home.downloadAction}
              </a>
              <a className="hero-tutorial" href="/tutorial">
                {home.tutorialAction}
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
              <Rich parts={home.introTitle} />
            </h2>
            <p className="home-section-lede">
              <Rich parts={home.introLede} />
            </p>
          </div>
          <div className="home-points">
            {home.reasons(manifest.skills.length).map((reason, index) => (
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
        className="home-steps home-steps--paper"
        aria-labelledby="home-steps-title"
      >
        <h2
          id="home-steps-title"
          className="home-section-title"
          data-reveal
        >
          {home.stepsTitle}
        </h2>
        <div className="home-step-grid">
          {home.steps.map((step, index) => (
            <div
              className="home-step"
              key={step.n}
              data-reveal="row"
              style={{ '--reveal-delay': `${index * 110}ms` }}
            >
              <b>{step.n}</b>
              <h3>{step.title}</h3>
              <p>
                <Rich parts={step.text} />
              </p>
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
              <Rich parts={home.skillsTitle(manifest.skills.length)} />
            </h2>
            <p className="home-section-lede">{home.skillsLede}</p>
            <a className="home-skills-link" href="/skills">
              {home.skillsLink}
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
                <p>{skillText(lang, skill, copy).summary}</p>
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
              <Rich parts={home.bandTitle} />
            </h2>
            <p>{home.bandText}</p>
          </div>
          <div
            className="home-band-progress"
            data-reveal
            style={{ '--reveal-delay': '90ms' }}
          >
            <h2>{home.progressTitle}</h2>
            <p>{home.progressText}</p>
          </div>
          <div
            className="home-band-actions"
            data-reveal
            style={{ '--reveal-delay': '180ms' }}
          >
            <a className="home-band-action" href="/app/upload">
              <span>{home.uploadAction}</span>
              <span className="home-band-arrow" aria-hidden="true">→</span>
            </a>
            <a className="home-band-action" href="/app/orders">
              <span>{home.ordersAction}</span>
              <span className="home-band-arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
