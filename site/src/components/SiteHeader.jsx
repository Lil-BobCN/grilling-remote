import { useEffect, useRef } from 'react'

export default function SiteHeader({ current }) {
  const headerRef = useRef(null)

  useEffect(() => {
    const header = headerRef.current
    if (!header) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const narrow = window.matchMedia('(max-width: 900px)')
    let frame = 0
    let last = ''

    const setProgress = (value) => {
      if (value === last) return
      last = value
      header.style.setProperty('--hp', value)
    }

    const update = () => {
      frame = 0

      if (reduced.matches || narrow.matches) {
        setProgress('0')
        return
      }

      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      )
      const end = Math.min(120, maxScroll)
      const raw = Math.min(1, Math.max(0, window.scrollY / end))
      setProgress((raw * raw * (3 - 2 * raw)).toFixed(4))
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
      <nav className="site-nav" aria-label="主导航">
        <div className="nav-left">
          <a
            className="pill"
            href="/download"
            aria-current={current === 'download' ? 'page' : undefined}
          >
            下载
          </a>
          <a
            className="pill"
            href="/skills"
            aria-current={current === 'skills' ? 'page' : undefined}
          >
            技能清单
          </a>
          <a
            className="pill"
            href="/tutorial"
            aria-current={current === 'tutorial' ? 'page' : undefined}
          >
            教程
          </a>
        </div>
        <a
          className="brand"
          href="/"
          aria-label="afkfactory 首页"
          aria-current={current === 'home' ? 'page' : undefined}
        >
          <span className="brand-full" aria-hidden="true">
            AFKFACTORY
          </span>
          <span className="brand-mark" aria-hidden="true">
            AFK
          </span>
        </a>
        <div className="nav-right">
          <a
            className="pill"
            href="/app/orders"
            aria-current={current === 'orders' ? 'page' : undefined}
          >
            我的订单
          </a>
          <a
            className="pill pill-dark"
            href="/app/upload"
            aria-current={current === 'upload' ? 'page' : undefined}
          >
            上传工作区
          </a>
        </div>
      </nav>
    </header>
  )
}
