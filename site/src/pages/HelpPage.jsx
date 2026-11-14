import PageShell from '../components/PageShell.jsx'
import { useI18n } from '../i18n/index.jsx'
import '../styles/help.css'

export default function HelpPage() {
  const { copy } = useI18n()
  const h = copy.help

  return (
    <PageShell
      path="/help"
      title={h.title}
      lede={h.lede}
      scaffold={false}
      className="help-page"
    >
      <section
        className="help-contact"
        aria-labelledby="help-contact-title"
        data-reveal
      >
        <div className="help-qr">
          <div className="help-qr-slot" aria-hidden="true">
            <span>{h.qrSlot}</span>
            <span>{h.qrPending}</span>
          </div>
          <p className="help-qr-note">{h.qrNote}</p>
        </div>
        <div className="help-contact-body">
          <h2 id="help-contact-title">{h.contactTitle}</h2>
          <p>{h.contactBody}</p>
          <p className="help-contact-note">{h.contactNote}</p>
        </div>
      </section>

      <section
        className="help-send"
        aria-labelledby="help-send-title"
        data-reveal="panel"
      >
        <div className="help-send-grid">
          <div>
            <h2 id="help-send-title">{h.sendTitle}</h2>
            <ol className="help-list">
              {h.sendItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
          <div>
            <h2>{h.dontTitle}</h2>
            <ul className="help-list">
              {h.dontItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section
        className="help-stuck"
        aria-labelledby="help-stuck-title"
        data-reveal
      >
        <h2 id="help-stuck-title">{h.stuckTitle}</h2>
        <p className="help-stuck-lede">{h.stuckLede}</p>
        <dl className="help-stuck-list">
          {h.stuck.map((item) => (
            <div className="help-stuck-row" key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                <span>{item.text}</span>
                <a href={item.href}>{item.link} →</a>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className="help-next"
        aria-labelledby="help-next-title"
        data-reveal="panel"
      >
        <div>
          <h2 id="help-next-title">{h.nextTitle}</h2>
          <p>{h.nextBody}</p>
        </div>
        <div className="help-next-actions">
          <a className="help-next-link" href="/tutorial">
            {h.guideLink}
          </a>
          <a className="help-next-link help-next-link-quiet" href="/app/orders">
            {h.ordersLink}
          </a>
        </div>
      </section>
    </PageShell>
  )
}
