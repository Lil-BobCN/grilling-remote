import { useEffect } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { initMotion } from '../motion.js'
import SiteFooter from './SiteFooter.jsx'
import SiteHeader from './SiteHeader.jsx'

export default function SiteLayout({ help = true, current, children }) {
  const { copy } = useI18n()

  useEffect(() => {
    initMotion()
  }, [])

  return (
    <>
      <a className="skip-link" href="#main">
        {copy.site.skip}
      </a>
      <SiteHeader current={current} />
      {children}
      <SiteFooter help={help} />
    </>
  )
}
