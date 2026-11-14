import { useEffect } from 'react'
import { useI18n } from '../i18n/index.jsx'

const THEME_COLORS = { light: '#f0eee6', dark: '#141413' }

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLORS[theme])
}

export default function ThemeToggle() {
  const { copy } = useI18n()

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const followSystem = () => {
      let stored = null
      try {
        stored = window.localStorage.getItem('afk-theme')
      } catch {
        // 隐私模式读不到存储，就按系统走
      }
      if (stored) return
      applyTheme(media.matches ? 'dark' : 'light')
    }

    media.addEventListener('change', followSystem)
    return () => media.removeEventListener('change', followSystem)
  }, [])

  const toggle = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    const next = dark ? 'light' : 'dark'
    applyTheme(next)

    try {
      window.localStorage.setItem('afk-theme', next)
    } catch {
      // 存不下就只在这次浏览里生效
    }
  }

  return (
    <button
      className="pill theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={copy.site.theme}
      title={copy.site.theme}
    >
      <svg
        className="theme-icon theme-icon-moon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />
      </svg>
      <svg
        className="theme-icon theme-icon-sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  )
}
