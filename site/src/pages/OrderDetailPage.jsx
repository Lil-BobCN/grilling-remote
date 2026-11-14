import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AccountBar from '../components/AccountBar.jsx'
import { Rich, useI18n } from '../i18n/index.jsx'
import { getOrder, readOrder } from '../api/account.js'
import {
  TIERS,
  buildOrderView,
  formatAt,
  historyRounds,
  stageCopy,
  substepRows,
  tierName,
} from '../progress.js'

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8v5" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

function stateTone(view) {
  if (view.invalid) return 'warn'
  if (view.tierLabel === '已完成') return 'done'
  return 'active'
}

function listItems(items) {
  return (items || [])
    .map((item) => {
      if (typeof item === 'string') return item
      return item?.text || item?.label || item?.name || ''
    })
    .filter(Boolean)
}

function stageDate(view, index, state, copy) {
  const words = copy.account.detail.stageDate
  if (state === 'pending') return words.pending
  if (view.justRejected && index === view.currentIndex) {
    return view.lastAt ? words.rejected(formatAt(view.lastAt)) : words.waitFix
  }
  if (index === 0 && view.invalid) {
    const invalidAt = [...view.transitions]
      .reverse()
      .find((transition) => transition.tier === '校验未通过')?.at
    return invalidAt ? words.updated(formatAt(invalidAt)) : words.fixUpload
  }
  const at = view.arrivals[index]
  if (!at) return state === 'current' ? words.current : words.unknown
  return state === 'current' ? words.arrived(formatAt(at)) : formatAt(at)
}

function Stepper({ view, selected, onSelect, tabsRef }) {
  const { lang, copy } = useI18n()
  const d = copy.account.detail
  const stateWords = d.stateWords

  const move = (event, index) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()

    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % TIERS.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + TIERS.length) % TIERS.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = TIERS.length - 1
    }

    onSelect(next)
    tabsRef.current[next]?.focus()
  }

  return (
    <div className="order-steps" role="tablist" aria-label={d.panel.stepperAria}>
      {TIERS.map((tier, index) => {
        const state = view.states[index]
        const isSelected = selected === index
        const lineState = index < view.currentIndex ? 'done' : 'pending'

        return (
          <button
            key={tier.key}
            ref={(node) => {
              tabsRef.current[index] = node
            }}
            className="order-step"
            type="button"
            role="tab"
            id={`order-tab-${index}`}
            aria-selected={isSelected}
            aria-controls="order-stage-panel"
            tabIndex={isSelected ? 0 : -1}
            data-state={state}
            data-line={lineState}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="order-step-marker" aria-hidden="true">
              {state === 'done' ? <CheckIcon /> : null}
              {state === 'warn' ? <AlertIcon /> : null}
              {state !== 'done' && state !== 'warn' ? index + 1 : null}
            </span>
            <span className="order-step-body">
              <span className="order-step-label">
                <span className="sr-only">{stateWords[state]}，</span>
                {tierName(lang, tier.key)}
                {index === view.currentIndex && view.round > 1 ? (
                  <span className="order-step-round">
                    {copy.account.orders.round(view.round)}
                  </span>
                ) : null}
                {index === 0 && view.invalid ? (
                  <span className="order-step-branch">
                    {copy.account.orders.checkFailed}
                  </span>
                ) : null}
              </span>
              <span className="order-step-date">
                {stageDate(view, index, state, copy)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function StagePanel({ view, selected }) {
  const { lang, copy } = useI18n()
  const d = copy.account.detail
  const copyText = stageCopy(view, selected, lang)
  const rows = substepRows(view, selected, lang)

  return (
    <div
      className="order-stage"
      id="order-stage-panel"
      role="tabpanel"
      aria-labelledby={`order-tab-${selected}`}
      tabIndex={0}
      key={selected}
    >
      <div className="order-stage-head">
        <div>
          <h3>{copyText.title}</h3>
          <p className="order-stage-intro">{copyText.intro}</p>
        </div>
        {copyText.tag ? <span className="order-stage-tag">{copyText.tag}</span> : null}
      </div>

      <ol className="order-subs">
        {rows.map((row) => (
          <li className="order-substep" data-state={row.state} key={row.key}>
            <span className="order-substep-dot" aria-hidden="true">
              {row.state === 'done' ? <CheckIcon /> : null}
            </span>
            <span className="order-substep-body">
              <span className="order-substep-title">{row.label}</span>
              <span className="order-substep-desc">{row.desc}</span>
            </span>
            <span className="order-substep-time">
              {row.time ? (
                <>
                  <span>{d.stageDate.arrived(row.time)}</span>
                  {row.updated ? (
                    <span>{d.stageDate.updated(row.updated)}</span>
                  ) : null}
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      {copyText.next ? <p className="order-stage-next">{copyText.next}</p> : null}
    </div>
  )
}

function NowBlock({ view }) {
  const { copy } = useI18n()
  const n = copy.account.detail.now

  if (!view.hasTransitions) {
    return (
      <section className="order-now order-now-quiet">
        <p>{n.empty}</p>
      </section>
    )
  }

  if (view.invalid) {
    const missing = listItems(view.missing)
    return (
      <section className="order-now" data-tone="attention">
        <div>
          <h2>{n.invalidTitle}</h2>
          <p>{n.invalidBody}</p>
          {missing.length ? (
            <ul className="order-missing">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>{n.invalidFallback}</p>
          )}
          <p className="order-now-note">{n.invalidNote}</p>
        </div>
        <a className="account-button" href="/app/upload">
          {n.reupload}
        </a>
      </section>
    )
  }

  if (view.justRejected) {
    return (
      <section className="order-now" data-tone="attention">
        <div>
          <h2>
            <Rich parts={n.rejectedTitle} />
          </h2>
          {view.feedback ? <blockquote>“{view.feedback}”</blockquote> : null}
          <p>{n.rejectedBody}</p>
        </div>
      </section>
    )
  }

  if (view.tierLabel === '开发中' && view.round > 1) {
    return (
      <section className="order-now">
        <div>
          <h2>
            <Rich parts={n.rejectedTitle} />
          </h2>
          {view.feedback ? <blockquote>“{view.feedback}”</blockquote> : null}
          <p>{n.rejectedWorkingBody}</p>
        </div>
      </section>
    )
  }

  if (view.tierLabel === '待客户验收') {
    const trial = listItems(view.trial)
    return (
      <section className="order-now" data-tone="ready">
        <div>
          <h2>{n.trialTitle}</h2>
          <p>{n.trialBody}</p>
          {trial.length ? (
            <ol className="order-trial">
              {trial.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          ) : (
            <p>{n.trialFallback}</p>
          )}
          <p className="order-now-note">{n.trialNote}</p>
        </div>
        {view.deliveryUrl ? (
          <a
            className="account-button"
            href={view.deliveryUrl}
            target="_blank"
            rel="noreferrer"
          >
            {n.deliveryLink}
          </a>
        ) : null}
      </section>
    )
  }

  if (view.tierLabel === '已完成') {
    return (
      <section className="order-now">
        <div>
          <h2>{n.doneTitle}</h2>
          <p>{n.doneBody}</p>
        </div>
        <a className="account-button account-button-quiet" href="/app/upload">
          {n.newRequest}
        </a>
      </section>
    )
  }

  return (
    <section className="order-now order-now-quiet">
      <p>
        <b>{n.quietPrefix}</b>
        {view.tierLabel === '开发中' ? n.quietWorking : n.quietWorkingNote}
      </p>
    </section>
  )
}

function History({ view }) {
  const { lang, copy } = useI18n()
  const d = copy.account.detail
  const rounds = historyRounds(view)
  const rejected = view.transitions.some(
    (transition) => transition.tier === '已驳回',
  )
  if (rounds.length < 2 && !rejected) return null

  return (
    <section className="order-history" aria-labelledby="order-history-title">
      <div className="order-history-head">
        <h2 id="order-history-title">{d.historyTitle}</h2>
        <p>{d.historyLede}</p>
      </div>

      {rounds.map(({ round, events }) => (
        <div className="order-history-round" key={round}>
          <h3>
            {d.historyRound(round)}
            {round === view.round ? d.historyNow : ''}
          </h3>
          <ol className="order-history-list">
            {events.map((event) => (
              <li
                key={`${event.tier}-${event.at}`}
                data-warn={event.tier === '已驳回' ? 'true' : undefined}
              >
                <time>{formatAt(event.at)}</time>
                <span className="order-history-dot" aria-hidden="true" />
                <span>{tierName(lang, event.tier)}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}

      {view.feedback && (view.tierLabel !== '开发中' || view.round === 1) ? (
        <blockquote className="order-history-quote">
          “{view.feedback}”
          <cite>{d.historyCite}</cite>
        </blockquote>
      ) : null}
    </section>
  )
}

function Side({ order, view }) {
  const { copy } = useI18n()
  const s = copy.account.detail.side

  return (
    <aside className="order-side" aria-label={s.aria}>
      <section className="order-side-block">
        <h3>{s.delivery}</h3>
        <p>{view.delivery || s.deliveryEmpty}</p>
        {view.delivery ? (
          <p className="order-side-note">{s.deliveryNote}</p>
        ) : null}
      </section>

      <section className="order-side-block">
        <h3>{s.orderTitle}</h3>
        <dl className="order-facts">
          <div>
            <dt>{s.number}</dt>
            <dd>{order.number || s.missing}</dd>
          </div>
          <div>
            <dt>{s.uploadAt}</dt>
            <dd>{formatAt(view.uploadAt) || s.missing}</dd>
          </div>
          <div>
            <dt>{s.round}</dt>
            <dd>{s.roundValue(view.round)}</dd>
          </div>
          <div>
            <dt>{s.updated}</dt>
            <dd>{formatAt(view.lastAt) || s.missing}</dd>
          </div>
        </dl>
      </section>

      <section className="order-side-block">
        <h3>{s.help}</h3>
        <p>{s.helpBody}</p>
        <a className="order-side-link" href="/help">
          {s.helpLink}
        </a>
      </section>
    </aside>
  )
}

function OrderDetail({ order, session, onLogout }) {
  const { lang, copy } = useI18n()
  const d = copy.account.detail
  const view = useMemo(() => buildOrderView(order, lang), [order, lang])
  const [selected, setSelected] = useState(view.currentIndex)
  const tabsRef = useRef([])

  useEffect(() => {
    document.title = `${order.title} · afkfactory`
  }, [order.title, lang])

  return (
    <main id="main" className="page account-page order-detail-page">
      <AccountBar session={session} onLogout={onLogout} />

      <a className="order-back" href="/app/orders">
        <span aria-hidden="true">←</span> {d.back}
      </a>

      <header className="order-detail-head">
        <div className="order-detail-main">
          <h1 className="orders-title">{order.title}</h1>
          <p className="order-detail-meta">
            {order.product ? (
              <span className="order-product">{order.product}</span>
            ) : null}
            {order.product && order.number ? ' · ' : null}
            {order.number || (order.product ? null : d.orderMeta)}
          </p>
          <p className="order-detail-lede">{view.lede}</p>
        </div>
        <div className="order-detail-status">
          <span className="order-detail-badges">
            <span className="account-state" data-tone={stateTone(view)}>
              {view.invalid ? copy.account.orders.checkFailed : view.tierName}
            </span>
            {view.round > 1 ? (
              <span className="account-round">
                {copy.account.orders.round(view.round)}
              </span>
            ) : null}
          </span>
          <span className="order-updated">
            {view.lastAt
              ? d.updated(formatAt(view.lastAt))
              : d.noProgress}
          </span>
        </div>
      </header>

      <NowBlock view={view} />

      <div className="order-detail-grid">
        <div className="order-detail-progress">
          <section
            className="order-progress"
            aria-labelledby="order-progress-title"
          >
            <div className="order-section-head">
              <h2 id="order-progress-title">{d.progressTitle}</h2>
              <p>{d.progressHint}</p>
            </div>

            <Stepper
              view={view}
              selected={selected}
              onSelect={setSelected}
              tabsRef={tabsRef}
            />
            <StagePanel view={view} selected={selected} />
          </section>

          <History view={view} />
        </div>

        <Side order={order} view={view} />
      </div>
    </main>
  )
}

function DetailShell({ session, onLogout, children }) {
  const { copy } = useI18n()

  return (
    <main id="main" className="page account-page order-detail-page">
      <AccountBar session={session} onLogout={onLogout} />
      <a className="order-back" href="/app/orders">
        <span aria-hidden="true">←</span> {copy.account.detail.back}
      </a>
      {children}
    </main>
  )
}

export default function OrderDetailPage({ id, session, onLogout }) {
  const { copy } = useI18n()
  const d = copy.account.detail
  const [state, setState] = useState('loading')
  const [order, setOrder] = useState(null)
  const [missingOrder, setMissingOrder] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    setMissingOrder(false)
    try {
      const payload = await getOrder(id)
      const nextOrder = readOrder(payload)
      if (!nextOrder) {
        setMissingOrder(true)
        setState('ready')
        return
      }
      setOrder(nextOrder)
      setState('ready')
    } catch (error) {
      if (error.status === 401) {
        window.location.replace(
          `/app?next=${encodeURIComponent(`/app/orders/${id}`)}`,
        )
        return
      }
      if (error.status === 404) {
        setMissingOrder(true)
        setState('ready')
        return
      }
      setState('error')
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (state === 'loading') {
    return (
      <DetailShell session={session} onLogout={onLogout}>
        <div className="order-detail-skeleton" aria-busy="true">
          <p className="orders-loading-text" role="status">
            {d.loading}
          </p>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </div>
      </DetailShell>
    )
  }

  if (state === 'error') {
    return (
      <DetailShell session={session} onLogout={onLogout}>
        <section className="orders-notice" role="alert">
          <h2>{d.errorTitle}</h2>
          <p>{d.errorBody}</p>
          <button className="account-button" type="button" onClick={load}>
            {d.retry}
          </button>
          <p className="orders-notice-hint">
            <Rich parts={d.helpHint} />
          </p>
        </section>
      </DetailShell>
    )
  }

  if (missingOrder) {
    return (
      <DetailShell session={session} onLogout={onLogout}>
        <section className="orders-notice">
          <h2>{d.missingTitle}</h2>
          <p>{d.missingBody}</p>
          <a className="account-button" href="/app/orders">
            {d.missingAction}
          </a>
          <p className="orders-notice-hint">
            <Rich parts={d.missingHint} />
          </p>
        </section>
      </DetailShell>
    )
  }

  return (
    <OrderDetail
      key={order.id || order.number || id}
      order={order}
      session={session}
      onLogout={onLogout}
    />
  )
}
