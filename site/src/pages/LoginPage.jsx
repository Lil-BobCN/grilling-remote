import { useEffect, useState } from 'react'
import { getSession, login } from '../api/account.js'
import { Rich, useI18n } from '../i18n/index.jsx'
import { TIERS, tierName } from '../progress.js'

function safeNext() {
  const next = new URLSearchParams(window.location.search).get('next')
  return next && next.startsWith('/app/') ? next : '/app/orders'
}

function EyeIcon({ crossed }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {crossed ? <path d="M3 3l18 18" /> : null}
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export default function LoginPage() {
  const { lang, copy } = useI18n()
  const l = copy.account.login
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 已经登录的人点「登录」，直接去看订单，不再填一遍密码。
  useEffect(() => {
    let alive = true
    getSession()
      .then(() => {
        if (alive) window.location.replace('/app/orders')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !password) {
      setError(l.errorEmpty)
      return
    }

    setBusy(true)
    setError('')

    try {
      await login(cleanEmail, password)
      window.location.assign(safeNext())
    } catch (requestError) {
      setError(
        requestError.status === 401 ? l.errorWrong : l.errorNetwork,
      )
      setBusy(false)
    }
  }

  return (
    <main id="main" className="page account-page login-page">
      <div className="login-grid">
        <section className="login-intro" aria-labelledby="login-title">
          <h1 id="login-title" className="login-title">
            {l.title}
          </h1>
          <p className="login-lede">{l.lede}</p>
          <p className="login-pitch">
            <Rich parts={l.pitch} />
          </p>

          <div className="login-guide">
            <h2>{l.stagesTitle}</h2>
            <ol className="login-stages">
              {TIERS.map((tier, index) => (
                <li className="login-stage" key={tier.key}>
                  <span className="login-stage-dot" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="login-stage-text">
                    <b>{tierName(lang, tier.key)}</b>
                    <span>{copy.progress.tiers[tier.key].short}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <p className="login-note">
            <Rich parts={l.note} />
          </p>
        </section>

        <section className="login-form-panel" aria-labelledby="login-form-title">
          <h2 id="login-form-title" className="login-form-title">
            {l.formTitle}
          </h2>
          <form className="login-form" onSubmit={submit} noValidate>
            <div className="login-field">
              <label className="login-label" htmlFor="login-email">
                {l.email}
              </label>
              <input
                className="login-input"
                id="login-email"
                type="email"
                name="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'login-error' : undefined}
              />
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="login-password">
                {l.password}
              </label>
              <span className="login-input-wrap">
                <input
                  className="login-input login-input-password"
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                />
                <button
                  className="login-eye"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? l.hidePassword : l.showPassword}
                >
                  <EyeIcon crossed={showPassword} />
                </button>
              </span>
            </div>

            <div className="login-actions">
              <button
                className="account-button login-submit"
                type="submit"
                disabled={busy}
              >
                {busy ? l.submitting : l.submit}
              </button>
              <button
                className="login-forgot-toggle"
                type="button"
                onClick={() => setForgotOpen((value) => !value)}
                aria-expanded={forgotOpen}
                aria-controls="login-forgot"
              >
                {l.forgot}
              </button>
            </div>

            {forgotOpen ? (
              <div className="login-forgot" id="login-forgot" role="note">
                <p>{l.forgotBody}</p>
                <a className="login-forgot-link" href="/help">
                  {l.forgotLink}
                </a>
              </div>
            ) : null}

            {error ? (
              <p className="login-error" id="login-error" role="alert">
                {error}
              </p>
            ) : null}
          </form>

          <p className="login-hint">
            <Rich parts={l.hint} />
          </p>
        </section>
      </div>
    </main>
  )
}
