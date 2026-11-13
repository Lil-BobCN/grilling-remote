export default function PageShell({ path, title, lede, children }) {
  return (
    <main id="main" className="page">
      <header className="page-head" data-reveal style={{ '--reveal-delay': '40ms' }}>
        <h1 className="page-title">{title}</h1>
        <p className="page-lede">{lede}</p>
      </header>
      <p className="scaffold-note" data-reveal style={{ '--reveal-delay': '140ms' }}>
        {`页面骨架 · ${path} · 内容待补`}
      </p>
      {children ? (
        <div className="page-body" data-reveal style={{ '--reveal-delay': '180ms' }}>
          {children}
        </div>
      ) : null}
    </main>
  )
}
