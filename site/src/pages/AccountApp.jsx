import { useCallback, useEffect, useMemo, useState } from 'react'
import SiteLayout from '../components/SiteLayout.jsx'
import { Rich, useI18n, usePageMeta } from '../i18n/index.jsx'
import LoginPage from './LoginPage.jsx'
import OrderDetailPage from './OrderDetailPage.jsx'
import OrdersPage from './OrdersPage.jsx'
import UploadPage from './UploadPage.jsx'
import { getSession, logout, readSession } from '../api/account.js'
import '../styles/account.css'
import '../styles/orders.css'

function normalizePath() {
  const path = window.location.pathname.replace(/\/index\.html$/, '')
  return path.length > 1 ? path.replace(/\/+$/, '') : path || '/'
}

function readRoute(path) {
  if (path === '/app') return { name: 'login', current: 'login' }
  if (path === '/app/orders') {
    return { name: 'orders', current: 'orders', needsAuth: true }
  }

  // 上传页自己处理登录态，不走账号区重定向。
  if (path === '/app/upload') {
    return { name: 'upload', current: 'upload' }
  }

  const detail = path.match(/^\/app\/orders\/([^/]+)$/)
  if (detail) {
    let id = detail[1]
    try {
      id = decodeURIComponent(id)
    } catch {
      // 地址里的百分号坏了，按原文去查，查不到就显示没找到
    }
    return { name: 'detail', current: 'orders', needsAuth: true, id }
  }

  return { name: 'missing', current: null }
}

const TITLES = {
  login: 'login',
  orders: 'orders',
  detail: 'detail',
  upload: 'upload',
  missing: 'missing',
}

export default function AccountApp() {
  const { copy } = useI18n()
  const a = copy.account.app
  const path = normalizePath()
  const route = readRoute(path)
  const [session, setSession] = useState(null)
  const [sessionState, setSessionState] = useState(
    route.needsAuth ? 'loading' : 'ready',
  )

  const pageMeta = useMemo(
    () => ({
      // 订单详情用单据名做标题，由 OrderDetail 自己写，账号壳不覆盖。
      title:
        route.name === 'detail' ? '' : copy.meta.app[TITLES[route.name]],
      description: copy.meta.app.description,
    }),
    [copy, route.name],
  )
  usePageMeta(pageMeta)

  const loadSession = useCallback(async () => {
    setSessionState('loading')
    try {
      const payload = await getSession()
      setSession(readSession(payload))
      setSessionState('ready')
    } catch (error) {
      if (error.status === 401) {
        window.location.replace(`/app?next=${encodeURIComponent(path)}`)
        return
      }
      setSessionState('error')
    }
  }, [path])

  useEffect(() => {
    if (!route.needsAuth) return
    loadSession()
  }, [route.needsAuth, loadSession])

  const handleLogout = useCallback(async () => {
    await logout()
    window.location.replace('/app')
  }, [])

  let content
  if (route.name === 'login') {
    content = <LoginPage />
  } else if (route.name === 'upload') {
    content = <UploadPage />
  } else if (route.name === 'missing') {
    content = (
      <main id="main" className="page account-page">
        <h1 className="orders-title">{a.missingTitle}</h1>
        <p className="orders-lede">{a.missingBody}</p>
        <p className="account-links">
          <a className="account-link" href="/">
            {a.homeLink}
          </a>
          <a className="account-link" href="/app/orders">
            {a.ordersLink}
          </a>
        </p>
      </main>
    )
  } else if (sessionState === 'loading') {
    content = (
      <main id="main" className="page account-page" aria-busy="true">
        <p className="orders-loading-text" role="status">
          {a.loading}
        </p>
        <div className="orders-skeleton-row" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </main>
    )
  } else if (sessionState === 'error') {
    content = (
      <main id="main" className="page account-page">
        <section className="orders-notice" role="alert">
          <h2>{a.errorTitle}</h2>
          <p>{a.errorBody}</p>
          <button className="account-button" type="button" onClick={loadSession}>
            {a.retry}
          </button>
          <p className="orders-notice-hint">
            <Rich parts={a.helpHint} />
          </p>
        </section>
      </main>
    )
  } else if (route.name === 'orders') {
    content = <OrdersPage session={session} onLogout={handleLogout} />
  } else {
    content = (
      <OrderDetailPage
        id={route.id}
        session={session}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <SiteLayout help={false} current={route.current}>
      {content}
    </SiteLayout>
  )
}
