import { useState } from 'react'
import { login } from '../api/account.js'
import { TIERS } from '../progress.js'

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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !password) {
      setError('邮箱和密码都要填。')
      return
    }

    setBusy(true)
    setError('')

    try {
      await login(cleanEmail, password)
      window.location.assign(safeNext())
    } catch (requestError) {
      setError(
        requestError.status === 401
          ? '邮箱或密码不对。忘了密码，微信找客服重设。'
          : '登录没成功。看看网络，再试一次。',
      )
      setBusy(false)
    }
  }

  return (
    <main id="main" className="page account-page login-page">
      <div className="login-grid">
        <section className="login-intro" aria-labelledby="login-title">
          <h1 id="login-title" className="login-title">
            登录
          </h1>
          <p className="login-lede">用我们发给你的邮箱和密码。</p>
          <p className="login-pitch">
            登录后，每一单走到哪一步、下一步做什么，都在
            <span className="login-nowrap">「我的订单」</span>里。
          </p>

          <div className="login-guide">
            <h2>你会看到的五档</h2>
            <ol className="login-stages">
              {TIERS.map((tier, index) => (
                <li className="login-stage" key={tier.key}>
                  <span className="login-stage-dot" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="login-stage-text">
                    <b>{tier.key}</b>
                    <span>{tier.short}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <p className="login-note">
            账号由我们开通，密码通过微信发给你。忘了密码，微信找客服重设。
          </p>
        </section>

        <section className="login-form-panel" aria-labelledby="login-form-title">
          <h2 id="login-form-title" className="login-form-title">
            邮箱登录
          </h2>
          <form className="login-form" onSubmit={submit} noValidate>
            <div className="login-field">
              <label className="login-label" htmlFor="login-email">
                邮箱
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
                密码
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
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
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
                {busy ? '正在登录…' : '登录'}
              </button>
              <button
                className="login-forgot-toggle"
                type="button"
                onClick={() => setForgotOpen((value) => !value)}
                aria-expanded={forgotOpen}
                aria-controls="login-forgot"
              >
                忘记密码？
              </button>
            </div>

            {forgotOpen ? (
              <div className="login-forgot" id="login-forgot" role="note">
                <p>
                  在微信里跟客服说「重设密码」，我们会发一个新的给你。电话只在微信联系不上时用。
                </p>
              </div>
            ) : null}

            {error ? (
              <p className="login-error" id="login-error" role="alert">
                {error}
              </p>
            ) : null}
          </form>

          <p className="login-hint">
            还没有账号？首期邀请制。要开通，微信找客服。
          </p>
        </section>
      </div>
    </main>
  )
}
