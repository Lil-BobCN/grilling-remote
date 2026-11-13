export default function SiteHeader({ current }) {
  return (
    <header className="site-header">
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
          AFKFACTORY
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
