import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AccountBar from '../components/AccountBar.jsx'
import { getOrder, readOrder } from '../api/account.js'
import {
  TIERS,
  buildOrderView,
  formatAt,
  historyRounds,
  stageCopy,
  substepRows,
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

const STATE_WORDS = {
  done: '已走过',
  current: '当前在这',
  pending: '还没到',
  warn: '有问题',
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

function stageDate(view, index, state) {
  if (state === 'pending') return '还没到'
  if (view.justRejected && index === view.currentIndex) {
    return view.lastAt ? `驳回 ${formatAt(view.lastAt)}` : '等你补完'
  }
  if (index === 0 && view.invalid) {
    const invalidAt = [...view.transitions]
      .reverse()
      .find((transition) => transition.tier === '校验未通过')?.at
    return invalidAt ? `${formatAt(invalidAt)} 更新` : '要补传'
  }
  const at = view.arrivals[index]
  if (!at) return state === 'current' ? '正在这里' : '时间未记录'
  return state === 'current' ? `${formatAt(at)} 到达` : formatAt(at)
}

function Stepper({ view, selected, onSelect, tabsRef }) {
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
    <div className="order-steps" role="tablist" aria-label="五档进度">
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
                <span className="sr-only">{STATE_WORDS[state]}，</span>
                {tier.key}
                {index === view.currentIndex && view.round > 1 ? (
                  <span className="order-step-round">第 {view.round} 轮</span>
                ) : null}
                {index === 0 && view.invalid ? (
                  <span className="order-step-branch">校验未通过</span>
                ) : null}
              </span>
              <span className="order-step-date">
                {stageDate(view, index, state)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function StagePanel({ view, selected }) {
  const copy = stageCopy(view, selected)
  const rows = substepRows(view, selected)

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
          <h3>{copy.title}</h3>
          <p className="order-stage-intro">{copy.intro}</p>
        </div>
        {copy.tag ? <span className="order-stage-tag">{copy.tag}</span> : null}
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
                  <span>到达 {row.time}</span>
                  {row.updated ? <span>更新 {row.updated}</span> : null}
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      {copy.next ? <p className="order-stage-next">{copy.next}</p> : null}
    </div>
  )
}

function NowBlock({ view }) {
  if (!view.hasTransitions) {
    return (
      <section className="order-now order-now-quiet">
        <p>这一单还没写进度。过一会儿再打开看看。有问题，微信找客服。</p>
      </section>
    )
  }

  if (view.invalid) {
    const missing = listItems(view.missing)
    return (
      <section className="order-now" data-tone="attention">
        <div>
          <h2>补好再传一次就行</h2>
          <p>还差这些：</p>
          {missing.length ? (
            <ul className="order-missing">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>缺什么、怎么补，看我们发给你的消息。也可以微信问客服。</p>
          )}
          <p className="order-now-note">
            补好后重新上传，会回到「已收到」，不用重新说需求。
          </p>
        </div>
        <a className="account-button" href="/app/upload">
          重新上传
        </a>
      </section>
    )
  }

  if (view.justRejected) {
    return (
      <section className="order-now" data-tone="attention">
        <div>
          <h2>上一轮你说的问题，<span className="order-nowrap">这一轮</span>在改</h2>
          {view.feedback ? <blockquote>“{view.feedback}”</blockquote> : null}
          <p>开工后会从「开工」重新走，做完再给你试。</p>
        </div>
      </section>
    )
  }

  if (view.tierLabel === '开发中' && view.round > 1) {
    return (
      <section className="order-now">
        <div>
          <h2>上一轮你说的问题，<span className="order-nowrap">这一轮</span>在改</h2>
          {view.feedback ? <blockquote>“{view.feedback}”</blockquote> : null}
          <p>这一轮从「开工」重新走，做完再给你试。</p>
        </div>
      </section>
    )
  }

  if (view.tierLabel === '待客户验收') {
    const trial = listItems(view.trial)
    return (
      <section className="order-now" data-tone="ready">
        <div>
          <h2>可以试了</h2>
          <p>做好了。麻烦试试这几件事：</p>
          {trial.length ? (
            <ol className="order-trial">
              {trial.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          ) : (
            <p>试用清单已经发给你。哪里不对，直接微信说。</p>
          )}
          <p className="order-now-note">哪里不对，直接微信说。</p>
        </div>
        {view.deliveryUrl ? (
          <a
            className="account-button"
            href={view.deliveryUrl}
            target="_blank"
            rel="noreferrer"
          >
            打开交付地址
          </a>
        ) : null}
      </section>
    )
  }

  if (view.tierLabel === '已完成') {
    return (
      <section className="order-now">
        <div>
          <h2>这单做完了</h2>
          <p>要仓库的话，找客服过户。有新需求，随时传。</p>
        </div>
        <a className="account-button account-button-quiet" href="/app/upload">
          传新需求
        </a>
      </section>
    )
  }

  return (
    <section className="order-now order-now-quiet">
      <p>
        <b>你不需要做什么。</b>
        {view.tierLabel === '开发中' ? '我们在做。' : '我们在做，做完会微信告诉你。'}
      </p>
    </section>
  )
}

function History({ view }) {
  const rounds = historyRounds(view)
  const rejected = view.transitions.some(
    (transition) => transition.tier === '已驳回',
  )
  if (rounds.length < 2 && !rejected) return null

  return (
    <section className="order-history" aria-labelledby="order-history-title">
      <div className="order-history-head">
        <h2 id="order-history-title">经历</h2>
        <p>上一轮的时间留在这里，不占进度条。</p>
      </div>

      {rounds.map(({ round, events }) => (
        <div className="order-history-round" key={round}>
          <h3>
            第 {round} 轮{round === view.round ? ' · 现在' : ''}
          </h3>
          <ol className="order-history-list">
            {events.map((event) => (
              <li
                key={`${event.tier}-${event.at}`}
                data-warn={event.tier === '已驳回' ? 'true' : undefined}
              >
                <time>{formatAt(event.at)}</time>
                <span className="order-history-dot" aria-hidden="true" />
                <span>{event.tier}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}

      {view.feedback && (view.tierLabel !== '开发中' || view.round === 1) ? (
        <blockquote className="order-history-quote">
          “{view.feedback}”
          <cite>你上一轮说的</cite>
        </blockquote>
      ) : null}
    </section>
  )
}

function Side({ order, view }) {
  return (
    <aside className="order-side" aria-label="订单信息">
      <section className="order-side-block">
        <h3>交付地址</h3>
        <p>{view.delivery || '交付地址还没填。到交付时会发给你。'}</p>
        {view.delivery ? (
          <p className="order-side-note">交付到这里。不对就微信说。</p>
        ) : null}
      </section>

      <section className="order-side-block">
        <h3>这一单</h3>
        <dl className="order-facts">
          <div>
            <dt>单号</dt>
            <dd>{order.number || '未记录'}</dd>
          </div>
          <div>
            <dt>传包时间</dt>
            <dd>{formatAt(view.uploadAt) || '未记录'}</dd>
          </div>
          <div>
            <dt>当前轮次</dt>
            <dd>第 {view.round} 轮</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>{formatAt(view.lastAt) || '未记录'}</dd>
          </div>
        </dl>
      </section>

      <section className="order-side-block">
        <h3>有问题</h3>
        <p>在微信里直接说。电话只在微信联系不上时用。</p>
        <a className="order-side-link" href="/help">
          怎么找客服 →
        </a>
      </section>
    </aside>
  )
}

function OrderDetail({ order, session, onLogout }) {
  const view = useMemo(() => buildOrderView(order), [order])
  const [selected, setSelected] = useState(view.currentIndex)
  const tabsRef = useRef([])

  useEffect(() => {
    document.title = `${order.title} · afkfactory`
  }, [order.title])

  return (
    <main id="main" className="page account-page order-detail-page">
      <AccountBar session={session} onLogout={onLogout} />

      <a className="order-back" href="/app/orders">
        <span aria-hidden="true">←</span> 我的订单
      </a>

      <header className="order-detail-head">
        <div className="order-detail-main">
          <h1 className="orders-title">{order.title}</h1>
          <p className="order-detail-meta">
            {order.product ? (
              <span className="order-product">{order.product}</span>
            ) : null}
            {order.product && order.number ? ' · ' : null}
            {order.number || (order.product ? null : '订单')}
          </p>
          <p className="order-detail-lede">{view.lede}</p>
        </div>
        <div className="order-detail-status">
          <span className="order-detail-badges">
            <span className="account-state" data-tone={stateTone(view)}>
              {view.invalid ? '校验未通过' : view.tierLabel}
            </span>
            {view.round > 1 ? (
              <span className="account-round">第 {view.round} 轮</span>
            ) : null}
          </span>
          <span className="order-updated">
            {view.lastAt
              ? `最近更新 ${formatAt(view.lastAt)}`
              : '还没有进度记录'}
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
              <h2 id="order-progress-title">走到哪了</h2>
              <p>点一个节点，看这一档的细步骤。</p>
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
  return (
    <main id="main" className="page account-page order-detail-page">
      <AccountBar session={session} onLogout={onLogout} />
      <a className="order-back" href="/app/orders">
        <span aria-hidden="true">←</span> 我的订单
      </a>
      {children}
    </main>
  )
}

export default function OrderDetailPage({ id, session, onLogout }) {
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
            正在打开这一单…
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
          <h2>这张单没打开</h2>
          <p>可能是网络断了，或者服务在重启。过一会儿再试。</p>
          <button className="account-button" type="button" onClick={load}>
            再试一次
          </button>
          <p className="orders-notice-hint">
            一直打不开，<a href="/help">找客服</a>。
          </p>
        </section>
      </DetailShell>
    )
  }

  if (missingOrder) {
    return (
      <DetailShell session={session} onLogout={onLogout}>
        <section className="orders-notice">
          <h2>没找到这张单</h2>
          <p>可能链接过期了，或者这张单不在你这个账号下。</p>
          <a className="account-button" href="/app/orders">
            回我的订单
          </a>
          <p className="orders-notice-hint">
            确定没走错？<a href="/help">找客服</a>。
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
