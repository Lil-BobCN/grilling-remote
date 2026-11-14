import { useEffect } from 'react'
import { initMotion } from '../motion.js'
import SiteFooter from './SiteFooter.jsx'
import SiteHeader from './SiteHeader.jsx'

export default function SiteLayout({ help = true, current, children }) {
  useEffect(() => {
    initMotion()
  }, [])

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
