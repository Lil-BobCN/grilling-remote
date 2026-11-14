import { useCallback, useEffect, useState } from 'react'
import AccountBar from '../components/AccountBar.jsx'
import OrderTrack from '../components/OrderTrack.jsx'
import { Rich, useI18n } from '../i18n/index.jsx'
import { listOrders, readOrders } from '../api/account.js'
import {
  buildOrderView,
  formatAt,
  listSubline,
} from '../progress.js'

function stateTone(view) {
  if (view.invalid) return 'warn'
  if (view.tierLabel === '已完成') return 'done'
  return 'active'
}

function summaryText(views, copy) {
  if (!views.length) return ''
  const counts = { doing: 0, invalid: 0, trial: 0, done: 0, received: 0 }

  for (const view of views) {
    if (view.invalid) counts.invalid += 1
    else if (view.tierLabel === '待客户验收') counts.trial += 1
    else if (view.tierLabel === '已完成') counts.done += 1
    else if (view.tierLabel === '开发中' || view.tierLabel === '安排中') {
      counts.doing += 1
    } else counts.received += 1
  }

  const bits = []
  const words = copy.account.orders.summaryBits
  if (counts.doing) bits.push(words.doing(counts.doing))
  if (counts.invalid) bits.push(words.invalid(counts.invalid))
  if (counts.trial) bits.push(words.trial(counts.trial))
  if (counts.received) bits.push(words.received(counts.received))
  if (counts.done) bits.push(words.done(counts.done))

  return copy.account.orders.summary(views.length, bits)
}

function OrderRow({ order, view }) {
  const { lang, copy } = useI18n()
  const o = copy.account.orders
  const href = order.id
    ? `/app/orders/${encodeURIComponent(order.id)}`
    : order.number
      ? `/app/orders/${encodeURIComponent(order.number)}`
      : ''

  const content = (
    <>
      <span className="order-row-main">
        <span className="order-title">{order.title}</span>
        <span className="order-meta">
          {order.product ? (
            <span className="order-product">{order.product}</span>
          ) : null}
          {order.product && order.number ? ' · ' : null}
          {order.number || (order.product ? null : o.metaOrder)}
        </span>
      </span>

      <OrderTrack states={view.states} />

      <span className="order-row-side">
        <span className="order-row-badges">
          <span className="account-state" data-tone={stateTone(view)}>
            {view.invalid ? o.checkFailed : view.tierName}
          </span>
          {view.round > 1 ? (
            <span className="account-round">{o.round(view.round)}</span>
          ) : null}
        </span>
        <span className="order-sub">{listSubline(view, lang)}</span>
        <span className="order-updated">
          {view.lastAt ? o.updated(formatAt(view.lastAt)) : o.noProgress}
        </span>
      </span>

      {href ? (
        <span className="order-go" aria-hidden="true">
          →
        </span>
      ) : null}
    </>
  )

  if (!href) return <div className="order-row order-row-static">{content}</div>

  return (
    <a className="order-row" href={href}>
      {content}
    </a>
  )
}

export default function OrdersPage({ session, onLogout }) {
  const { lang, copy } = useI18n()
  const o = copy.account.orders
  const [state, setState] = useState('loading')
  const [orders, setOrders] = useState([])

  const load = useCallback(async () => {
    setState('loading')
    try {
      const payload = await listOrders()
      setOrders(readOrders(payload))
      setState('ready')
    } catch (error) {
      if (error.status === 401) {
        window.location.replace(
          `/app?next=${encodeURIComponent('/app/orders')}`,
        )
        return
      }
      setState('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 语言切换时只重算显示文字，不重新请求订单。
  const rows = orders
    .map((order) => ({ order, view: buildOrderView(order, lang) }))
    .sort(
      (left, right) =>
        new Date(right.view.lastAt || 0).getTime() -
        new Date(left.view.lastAt || 0).getTime(),
    )
  const views = rows.map((item) => item.view)

  return (
    <main id="main" className="page account-page orders-page">
      <AccountBar session={session} onLogout={onLogout} />

      <header className="orders-head">
        <div>
          <h1 className="orders-title">{o.title}</h1>
          <p className="orders-lede">{o.lede}</p>
        </div>
        <a className="orders-upload" href="/app/upload">
          {o.uploadLink}
        </a>
      </header>

      {state === 'loading' ? (
        <div className="orders-skeleton" aria-busy="true">
          <p className="orders-loading-text" role="status">
            {o.loading}
          </p>
          {[0, 1, 2].map((row) => (
            <div className="orders-skeleton-row" key={row} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <section className="orders-notice" role="alert">
          <h2>{o.errorTitle}</h2>
          <p>{o.errorBody}</p>
          <button className="account-button" type="button" onClick={load}>
            {o.retry}
          </button>
          <p className="orders-notice-hint">
            <Rich parts={o.helpHint} />
          </p>
        </section>
      ) : null}

      {state === 'ready' && views.length === 0 ? (
        <section className="orders-notice">
          <h2>{o.emptyTitle}</h2>
          <p>{o.emptyBody}</p>
          <a className="account-button" href="/app/upload">
            {o.emptyAction}
          </a>
          <p className="orders-notice-hint">
            <Rich parts={o.emptyHint} />
          </p>
        </section>
      ) : null}

      {state === 'ready' && views.length > 0 ? (
        <>
          <p className="orders-summary">{summaryText(views, copy)}</p>
          <ol className="orders-list">
            {rows.map(({ order, view }, index) => (
              <li key={order.id || order.number || index}>
                <OrderRow order={order} view={view} />
              </li>
            ))}
          </ol>
          <p className="orders-foot">
            <Rich parts={o.foot} />
          </p>
        </>
      ) : null}
    </main>
  )
}
