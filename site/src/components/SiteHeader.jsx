import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/index.jsx'
import LanguageToggle from './LanguageToggle.jsx'
import ThemeToggle from './ThemeToggle.jsx'

const BRAND = 'AFKFACTORY'
const MORPH_DISTANCE = 480

export default function SiteHeader({ current }) {
  const { copy } = useI18n()
  const nav = copy.site.nav
  const headerRef = useRef(null)

  useEffect(() => {
    const header = headerRef.current
    if (!header) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const narrow = window.matchMedia('(max-width: 900px)')
    let frame = 0
    let last = ''
    let lastGlass = null
    let glassOverride = false

    const setProgress = (value) => {
      if (value === last) return
      last = value
      header.style.setProperty('--hp', value)
    }

    // 减少动态时不做字标变形，但顶栏仍要在滚动后收成不透明的磨砂面。
    const setGlass = (value) => {
      glassOverride = true
      if (value === lastGlass) return
      lastGlass = value
      header.style.setProperty('--hp-glass', value)
    }

    const clearGlass = () => {
      if (!glassOverride) return
      glassOverride = false
      lastGlass = null
      header.style.removeProperty('--hp-glass')
    }

    const update = () => {
      frame = 0

      if (narrow.matches) {
        setProgress('0')
        setGlass('0')
        return
      }

      if (reduced.matches) {
        setProgress('0')
        setGlass(window.scrollY > 8 ? '1' : '0')
        return
      }

      clearGlass()
      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      )
      const end = Math.min(MORPH_DISTANCE, maxScroll)
      const raw = Math.min(1, Math.max(0, window.scrollY / end))
      setProgress(raw.toFixed(4))
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }

    update()

    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    reduced.addEventListener('change', schedule)
    narrow.addEventListener('change', schedule)

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      reduced.removeEventListener('change', schedule)
      narrow.removeEventListener('change', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <header ref={headerRef} className="site-header">
      <nav className="site-nav" aria-label={copy.site.navLabel}>
        <div className="nav-left">
          <a
            className="pill"
            href="/download"
            aria-current={current === 'download' ? 'page' : undefined}
          >
            {nav.download}
          </a>
          <a
            className="pill"
            href="/skills"
            aria-current={current === 'skills' ? 'page' : undefined}
          >
            {nav.skills}
          </a>
          <a
            className="pill"
            href="/tutorial"
            aria-current={current === 'tutorial' ? 'page' : undefined}
          >
            {nav.tutorial}
          </a>
        </div>
        <a
          className="brand"
          href="/"
          aria-label={copy.site.brandHome}
          aria-current={current === 'home' ? 'page' : undefined}
        >
          <span className="brand-full" aria-hidden="true">
            {[...BRAND].map((letter, index) => (
              <span
                className="brand-letter"
                style={{
                  '--letter-index': index,
                  '--letter-start':
                    index < 3 ? 2 : 0.12 + (BRAND.length - 1 - index) * 0.065,
                }}
                key={index}
              >
                {letter}
              </span>
            ))}
          </span>
        </a>
        <div className="nav-right">
          <ThemeToggle />
          <LanguageToggle />
          <a
            className="pill"
            href="/app"
            aria-current={current === 'login' ? 'page' : undefined}
          >
            {nav.login}
          </a>
          <a
            className="pill"
            href="/app/orders"
            aria-current={current === 'orders' ? 'page' : undefined}
          >
            {nav.orders}
          </a>
          <a
            className="pill pill-dark"
            href="/app/upload"
            aria-current={current === 'upload' ? 'page' : undefined}
            aria-label={nav.upload}
          >
            <span className="nav-upload-full">{nav.upload}</span>
            <span className="nav-upload-short">{nav.uploadShort}</span>
          </a>
        </div>
      </nav>
    </header>
  )
}
