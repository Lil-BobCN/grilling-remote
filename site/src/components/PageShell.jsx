export default function PageShell({
  path,
  title,
  lede,
  scaffold = true,
  className = '',
  children,
}) {
  return (
    <main id="main" className={`page ${className}`.trim()}>
      <header className="page-head" data-reveal style={{ '--reveal-delay': '40ms' }}>
        <h1 className="page-title">{title}</h1>
        <p className="page-lede">{lede}</p>
      </header>
      {scaffold ? (
        <p className="scaffold-note" data-reveal style={{ '--reveal-delay': '140ms' }}>
          {`页面骨架 · ${path} · 内容待补`}
        </p>
      ) : null}
      {children ? (
        <div className="page-body">
          {children}
        </div>
      ) : null}
    </main>
  )
}
