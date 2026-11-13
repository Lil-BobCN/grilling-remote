import { useEffect, useState } from 'react'

export default function SiteHeader({ current }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    let frame = 0

    const update = () => {
      frame = 0
      setCollapsed((wasCollapsed) => {
        const y = window.scrollY
        return wasCollapsed ? y > 10 : y > 28
      })
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <header className="site-header" data-collapsed={collapsed ? '' : undefined}>
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
            AF
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
