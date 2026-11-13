import SiteFooter from './SiteFooter.jsx'
import SiteHeader from './SiteHeader.jsx'

export default function SiteLayout({ help = true, current, children }) {
  return (
    <>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <SiteHeader current={current} />
      {children}
      <SiteFooter help={help} />
    </>
  )
}
