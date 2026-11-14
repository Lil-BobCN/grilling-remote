import { useI18n } from '../i18n/index.jsx'

export default function PageShell({
  path,
  title,
  lede,
  scaffold = true,
  className = '',
  children,
}) {
  const { copy } = useI18n()

  return (
    <main id="main" className={`page ${className}`.trim()}>
      <header className="page-head" data-reveal style={{ '--reveal-delay': '40ms' }}>
        <h1 className="page-title">{title}</h1>
        <p className="page-lede">{lede}</p>
      </header>
      {scaffold ? (
        <p className="scaffold-note" data-reveal style={{ '--reveal-delay': '140ms' }}>
          {copy.site.scaffold(path)}
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
