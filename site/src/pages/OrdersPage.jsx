import { useCallback, useEffect, useState } from 'react'
import AccountBar from '../components/AccountBar.jsx'
import OrderTrack from '../components/OrderTrack.jsx'
import { listOrders, readOrders } from '../api/account.js'
import { buildOrderView, formatAt, listSubline } from '../progress.js'

function stateTone(view) {
  if (view.invalid) return 'warn'
  if (view.tierLabel === '已完成') return 'done'
  return 'active'
}

function summaryText(views) {
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
  if (counts.doing) bits.push(`${counts.doing} 个在做`)
  if (counts.invalid) bits.push(`${counts.invalid} 个等你补文件`)
  if (counts.trial) bits.push(`${counts.trial} 个等你试`)
  if (counts.received) bits.push(`${counts.received} 个刚收到`)
  if (counts.done) bits.push(`${counts.done} 个已完成`)

  return `你有 ${views.length} 个订单。${bits.length ? `${bits.join('，')}。` : ''}`
}

function OrderRow({ order, view }) {
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
          {order.number || (order.product ? null : '订单')}
        </span>
      </span>

      <OrderTrack states={view.states} />

      <span className="order-row-side">
        <span className="order-row-badges">
          <span className="account-state" data-tone={stateTone(view)}>
            {view.invalid ? '校验未通过' : view.tierLabel}
          </span>
          {view.round > 1 ? (
            <span className="account-round">第 {view.round} 轮</span>
          ) : null}
        </span>
        <span className="order-sub">{listSubline(view)}</span>
        <span className="order-updated">
          {view.lastAt ? `最近更新 ${formatAt(view.lastAt)}` : '还没有进度记录'}
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
  const [state, setState] = useState('loading')
  const [items, setItems] = useState([])

  const load = useCallback(async () => {
    setState('loading')
    try {
      const payload = await listOrders()
      const rows = readOrders(payload)
        .map((order) => ({ order, view: buildOrderView(order) }))
        .sort(
          (left, right) =>
            new Date(right.view.lastAt || 0).getTime() -
            new Date(left.view.lastAt || 0).getTime(),
        )
      setItems(rows)
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

  const views = items.map((item) => item.view)

  return (
    <main id="main" className="page account-page orders-page">
      <AccountBar session={session} onLogout={onLogout} />

      <header className="orders-head">
        <div>
          <h1 className="orders-title">我的订单</h1>
          <p className="orders-lede">每一单走到哪、下一步是什么，都写在这里。</p>
        </div>
        <a className="orders-upload" href="/app/upload">
          传新需求 →
        </a>
      </header>

      {state === 'loading' ? (
        <div className="orders-skeleton" aria-busy="true">
          <p className="orders-loading-text" role="status">
            正在打开订单…
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
          <h2>订单没打开</h2>
          <p>可能是网络断了，或者服务在重启。过一会儿再试。</p>
          <button className="account-button" type="button" onClick={load}>
            再试一次
          </button>
          <p className="orders-notice-hint">
            一直打不开，<a href="/tutorial#support">找客服</a>。
          </p>
        </section>
      ) : null}

      {state === 'ready' && views.length === 0 ? (
        <section className="orders-notice">
          <h2>还没有订单</h2>
          <p>把做完的工作区传回来，这里会出现第一单的进度。</p>
          <a className="account-button" href="/app/upload">
            上传工作区
          </a>
          <p className="orders-notice-hint">
            还不知道怎么传？<a href="/tutorial">看教程</a>。
          </p>
        </section>
      ) : null}

      {state === 'ready' && views.length > 0 ? (
        <>
          <p className="orders-summary">{summaryText(views)}</p>
          <ol className="orders-list">
            {items.map(({ order, view }, index) => (
              <li key={order.id || order.number || index}>
                <OrderRow order={order} view={view} />
              </li>
            ))}
          </ol>
          <p className="orders-foot">
            只看得到你自己账号下的订单。有问题，
            <a href="/tutorial#support">找客服</a>。
          </p>
        </>
      ) : null}
    </main>
  )
}
