export default function PageShell({ path, title, lede, children }) {
  return (
    <main id="main" className="page">
      <header className="page-head">
        <h1 className="page-title">{title}</h1>
        <p className="page-lede">{lede}</p>
      </header>
      <p className="scaffold-note">{`页面骨架 · ${path} · 内容待补`}</p>
      {children ? <div className="page-body">{children}</div> : null}
    </main>
  )
}
