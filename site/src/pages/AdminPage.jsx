import { useCallback, useEffect, useState } from 'react'
import AccountBar from '../components/AccountBar.jsx'
import OrderTrack from '../components/OrderTrack.jsx'
import { useI18n } from '../i18n/index.jsx'
import {
  listAdminOrders,
  markMessageSent,
  readOrders,
} from '../api/account.js'
import {
  buildOrderView,
  internalStage,
  latestSubline,
  messagesDue,
  stayDays,
} from '../progress.js'
import '../styles/admin.css'

const FILTERS = ['all', 'due', 'stuck', 'done']

function sortRows(rows) {
  return [...rows].sort(
    (left, right) =>
      new Date(right.view.lastAt || 0).getTime() -
      new Date(left.view.lastAt || 0).getTime(),
  )
}

function Stats({ rows, copy }) {
  const active = rows.filter((row) => row.view.tierLabel !== '已完成').length
  const due = rows.filter((row) => row.due).length
  const stuck = rows.filter((row) => row.view.stuck).length

  return (
    <div className="admin-stats">
      <div className="admin-stat">
        <span className="admin-stat-num">{active}</span>
        <span className="admin-stat-label">{copy.stats.active}</span>
      </div>
      <div className="admin-stat" data-tone="due">
        <span className="admin-stat-num">{due}</span>
        <span className="admin-stat-label">{copy.stats.due}</span>
      </div>
      <div className="admin-stat" data-tone="stuck">
        <span className="admin-stat-num">{stuck}</span>
        <span className="admin-stat-label">{copy.stats.stuck}</span>
      </div>
    </div>
  )
}

function Filters({ rows, filter, onChange, copy }) {
  const counts = {
    all: rows.length,
    due: rows.filter((row) => row.due).length,
    stuck: rows.filter((row) => row.view.stuck).length,
    done: rows.filter((row) => row.view.tierLabel === '已完成').length,
  }

  return (
    <div className="admin-filters" role="group" aria-label={copy.title}>
      {FILTERS.map((key) => (
        <button
          key={key}
          className="admin-filter"
          type="button"
          aria-pressed={filter === key}
          onClick={() => onChange(key)}
        >
          {copy.filters[key]}
          <span>{counts[key]}</span>
        </button>
      ))}
    </div>
  )
}

function visible(row, filter) {
  if (filter === 'due') return Boolean(row.due)
  if (filter === 'stuck') return row.view.stuck
  if (filter === 'done') return row.view.tierLabel === '已完成'
  return true
}

function CustomerCell({ order }) {
  const customer = order.customer || {}
  const name = customer.display_name || customer.email || '—'
  const short = customer.short_name || customer.email || ''
  return (
    <div className="admin-customer">
      <span className="admin-avatar" aria-hidden="true">
        {name.slice(0, 1)}
      </span>
      <span>
        <b>{name}</b>
        {short ? <small>{short}</small> : null}
      </span>
    </div>
  )
}

function DeliveryCell({ order, copy }) {
  const delivery = order.deliveryUrl || order.delivery
  if (!delivery) return <span className="admin-dash">{copy.deliveryEmpty}</span>
  if (!/^https?:\/\//i.test(delivery)) {
    return <span className="admin-delivery" title={delivery}>{delivery}</span>
  }
  return (
    <a
      className="admin-delivery"
      href={delivery}
      title={delivery}
      target="_blank"
      rel="noreferrer"
    >
      {delivery}
    </a>
  )
}

function AdminRow({ row, copy, notBuilt, marking, onMarkSent }) {
  const { order, view, due } = row
  const stage = internalStage(view)
  const subline = latestSubline(view)
  const stay = stayDays(view)

  return (
    <tr data-due={due ? 'true' : undefined}>
      <td>
        <CustomerCell order={order} />
      </td>
      <td>
        <span className="admin-order-title">{order.title}</span>
        <span className="admin-order-meta">
          {[order.number, order.product].filter(Boolean).join(' · ')}
        </span>
      </td>
      <td>
        <span className="admin-tier">
          {view.invalid ? notBuilt : view.tierName}
        </span>
        {view.round > 1 ? (
          <span className="admin-round">{view.round}</span>
        ) : null}
      </td>
      <td>
        <span className="admin-stage">{copy.internal[stage] || stage || '—'}</span>
        {subline ? <span className="admin-stage-sub">{subline}</span> : null}
      </td>
      <td className="admin-stay">{stay == null ? copy.none : copy.stay(stay)}</td>
      <td>
        {view.stuck ? (
          <span className="admin-stuck" title={view.stuckNote || ''}>
            <i aria-hidden="true" />
            {copy.stuckFlag}
          </span>
        ) : (
          <span className="admin-dash">{copy.none}</span>
        )}
      </td>
      <td>
        <DeliveryCell order={order} copy={copy} />
      </td>
      <td>
        <OrderTrack states={view.states} />
      </td>
      <td>
        <div className="admin-actions">
          {due ? (
            <button
              className="admin-mark"
              type="button"
              disabled={marking}
              onClick={() => onMarkSent(order, due)}
            >
              {marking ? copy.marking : copy.markSent}
            </button>
          ) : null}
          {due ? (
            <span className="admin-due">
              {copy.dueLabel(copy.dueTypes[due.type] || due.type)}
            </span>
          ) : (
            <span className="admin-dash">{copy.none}</span>
          )}
          {order.issueUrl ? (
            <a
              className="admin-issue"
              href={order.issueUrl}
              target="_blank"
              rel="noreferrer"
            >
              {copy.issueLink}
            </a>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

export default function AdminPage({ session, onLogout }) {
  const { lang, copy } = useI18n()
  const a = copy.account.admin
  const [state, setState] = useState('loading')
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('all')
  const [markingId, setMarkingId] = useState('')
  const [markError, setMarkError] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    setMarkError('')
    try {
      const payload = await listAdminOrders()
      setOrders(readOrders(payload))
      setState('ready')
    } catch (error) {
      if (error.status === 401) {
        window.location.replace(
          `/app?next=${encodeURIComponent('/app/admin')}`,
        )
        return
      }
      if (error.status === 403) {
        setState('denied')
        return
      }
      setState('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const now = Date.now()
  const rows = sortRows(
    orders.map((order) => {
      const view = buildOrderView(order, lang)
      return { order, view, due: messagesDue(order, view, now) }
    }),
  )

  const shown = rows.filter((row) => visible(row, filter))

  const handleMarkSent = async (order, due) => {
    if (markingId) return
    setMarkingId(order.id)
    setMarkError('')
    try {
      const payload = await markMessageSent(order.id, due)
      const messages = Array.isArray(payload?.messages) ? payload.messages : []
      setOrders((current) =>
        current.map((item) =>
          item.id === order.id ? { ...item, messages } : item,
        ),
      )
    } catch (error) {
      setMarkError(error.status === 404 ? a.markFailed : error.message || a.markFailed)
    } finally {
      setMarkingId('')
    }
  }

  return (
    <main id="main" className="page account-page admin-page">
      <AccountBar session={session} onLogout={onLogout} />

      <header className="admin-head">
        <div>
          <p className="admin-eyebrow">{a.eyebrow}</p>
          <h1 className="orders-title">{a.title}</h1>
          <p className="orders-lede">{a.lede}</p>
        </div>
      </header>

      {state === 'loading' ? (
        <div className="admin-loading" aria-busy="true">
          <p role="status">{a.loading}</p>
        </div>
      ) : null}

      {state === 'error' ? (
        <section className="orders-notice" role="alert">
          <h2>{a.errorTitle}</h2>
          <p>{a.errorBody}</p>
          <button className="account-button" type="button" onClick={load}>
            {a.retry}
          </button>
        </section>
      ) : null}

      {state === 'denied' ? (
        <section className="orders-notice" role="alert">
          <h2>{a.deniedTitle}</h2>
          <p>{a.deniedBody}</p>
          <a className="account-button" href="/app/orders">
            {a.deniedAction}
          </a>
        </section>
      ) : null}

      {state === 'ready' ? (
        <>
          <p className="admin-note">{a.note}</p>
          <Stats rows={rows} copy={a} />
          <Filters rows={rows} filter={filter} onChange={setFilter} copy={a} />

          {markError ? (
            <p className="admin-mark-error" role="alert">
              {markError}
            </p>
          ) : null}

          {rows.length === 0 ? (
            <p className="admin-empty">{a.empty}</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">{a.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{a.table.customer}</th>
                    <th scope="col">{a.table.requirement}</th>
                    <th scope="col">{a.table.tier}</th>
                    <th scope="col">{a.table.stage}</th>
                    <th scope="col">{a.table.stay}</th>
                    <th scope="col">{a.table.stuck}</th>
                    <th scope="col">{a.table.delivery}</th>
                    <th scope="col">{a.table.progress}</th>
                    <th scope="col">{a.table.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <AdminRow
                      key={row.order.id || row.order.number}
                      row={row}
                      copy={a}
                      notBuilt={copy.account.orders.notBuilt}
                      marking={markingId === row.order.id}
                      onMarkSent={handleMarkSent}
                    />
                  ))}
                </tbody>
              </table>
              {shown.length === 0 ? (
                <p className="admin-empty">{a.empty}</p>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </main>
  )
}
