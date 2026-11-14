import { useCallback, useEffect, useState } from 'react'
import SiteLayout from '../components/SiteLayout.jsx'
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
  if (path === '/app') return { name: 'login', current: 'orders' }
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
  login: '登录 · afkfactory',
  orders: '我的订单 · afkfactory',
  detail: '订单详情 · afkfactory',
  upload: '上传工作区 · afkfactory',
  missing: '页面不存在 · afkfactory',
}

export default function AccountApp() {
  const path = normalizePath()
  const route = readRoute(path)
  const [session, setSession] = useState(null)
  const [sessionState, setSessionState] = useState(
    route.needsAuth ? 'loading' : 'ready',
  )

  useEffect(() => {
    document.title = TITLES[route.name]
  }, [route.name])

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
        <h1 className="orders-title">页面不存在</h1>
        <p className="orders-lede">地址不对。回首页，或者去看订单。</p>
        <p className="account-links">
          <a className="account-link" href="/">
            回首页
          </a>
          <a className="account-link" href="/app/orders">
            我的订单
          </a>
        </p>
      </main>
    )
  } else if (sessionState === 'loading') {
    content = (
      <main id="main" className="page account-page" aria-busy="true">
        <p className="orders-loading-text" role="status">
          正在打开…
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
          <h2>账号没打开</h2>
          <p>可能是网络断了，或者服务在重启。过一会儿再试。</p>
          <button className="account-button" type="button" onClick={loadSession}>
            再试一次
          </button>
          <p className="orders-notice-hint">
            一直打不开，<a href="/tutorial#support">找客服</a>。
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
