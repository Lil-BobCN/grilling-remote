import release from '../../../customer-kit/release.json'
import { useI18n } from '../i18n/index.jsx'

export default function SiteFooter({ help = true }) {
  const { copy } = useI18n()
  const links = copy.site.footer

  return (
    <footer className="site-footer" data-reveal>
      {help ? (
        <a className="footer-help" href="/help">
          {copy.site.footerHelp}
        </a>
      ) : null}
      <div className="footer-links">
        <a href="/download">{links.download}</a>
        <a href="/skills">{links.skills}</a>
        <a href="/tutorial">{links.tutorial}</a>
        <a href="/app/upload">{links.upload}</a>
        <a href="/app">{links.login}</a>
        <a href="/app/orders">{links.orders}</a>
      </div>
      <p className="footer-meta">
        {release.version} · {release.date} · afkfactory.dev
      </p>
    </footer>
  )
}
