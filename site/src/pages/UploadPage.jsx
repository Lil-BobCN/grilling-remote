import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  getSession,
  login,
  logout,
  readSession,
} from '../api/account.js'
import { Rich, useI18n } from '../i18n/index.jsx'
import { TIERS, tierName } from '../progress.js'
import '../styles/upload.css'

/*
 * 账号接口走 ../api/account.js，和订单页用同一份契约（归 I-0035）。
 * 上传接口不在这份文件里，这里是唯一的直接调用：
 *   POST /app/api/uploads  <- multipart：file、finished=true
 */
const API_BASE = '/app/api'
const MAX_BYTES = 50 * 1024 * 1024

function pickMessage(data) {
  if (!data || typeof data !== 'object') return ''
  const value = data.message ?? data.error
  return typeof value === 'string' ? value : ''
}

function customerFrom(payload) {
  const user = readSession(payload)
  if (!user.email) return null

  return {
    name: user.displayName || user.email,
    email: user.email,
  }
}

function formatSize(bytes, copy) {
  if (bytes < 1024) return copy.account.upload.bytes(bytes)
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function validateFile(file, copy) {
  const u = copy.account.upload
  if (!/\.zip$/i.test(file.name)) return u.fileNotZip
  if (file.size === 0) return u.fileEmpty
  if (file.size > MAX_BYTES) return u.fileTooBig(formatSize(file.size, copy))
  return ''
}

function uploadErrorMessage(status, message, copy) {
  const u = copy.account.upload
  if (message) return message
  if (status === 413) return u.serverTooBig
  if (status === 415) return u.serverBadType
  if (status === 400 || status === 422) return u.serverRejected
  if (status >= 500) return u.serverError
  return u.serverUnknown
}

function LoginPanel({ notice, onLogin }) {
  const { copy } = useI18n()
  const u = copy.account.upload
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return

    const trimmed = email.trim()
    if (!trimmed || !password) {
      setError(u.loginEmpty)
      return
    }
    if (!trimmed.includes('@')) {
      setError(u.loginBadEmail)
      return
    }

    setBusy(true)
    setError('')

    try {
      await login(trimmed.toLowerCase(), password)
      const data = await getSession()
      const customer = customerFrom(data)
      if (!customer) {
        throw new ApiError(0, u.loginNoSession)
      }
      onLogin(customer)
    } catch (caught) {
      if (caught.status === 401) {
        setError(u.loginWrong)
      } else if (caught.status === 403) {
        setError(u.loginDisabled)
      } else {
        setError(caught.message || u.loginFailed)
      }
      setBusy(false)
    }
  }

  return (
    <form className="upload-login" onSubmit={submit} noValidate>
      <h2 className="upload-login-title">{u.loginTitle}</h2>
      <p className="upload-login-sub">{u.loginSub}</p>

      {notice ? (
        <p className="upload-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="upload-field">
        <label htmlFor="upload-email">{u.email}</label>
        <input
          id="upload-email"
          className="upload-input"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      </div>

      <div className="upload-field">
        <label htmlFor="upload-password">{u.password}</label>
        <input
          id="upload-password"
          className="upload-input"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </div>

      {error ? (
        <p className="upload-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="upload-login-actions">
        <button
          className="upload-button upload-button-primary"
          type="submit"
          disabled={busy}
        >
          {busy ? u.loggingIn : u.loginSubmit}
        </button>
        <a className="upload-help-link" href="/help">
          {u.forgot}
        </a>
      </div>
    </form>
  )
}

function AccountBar({ session, onLogout, loggingOut }) {
  const { copy } = useI18n()
  const u = copy.account.upload

  return (
    <div className="upload-account">
      <span className="upload-account-mark" aria-hidden="true">
        {session.name.slice(0, 1)}
      </span>
      <div className="upload-account-main">
        <p className="upload-account-name">{session.name}</p>
        <p className="upload-account-email">{session.email}</p>
      </div>
      <button
        className="upload-account-out"
        type="button"
        onClick={onLogout}
        disabled={loggingOut}
      >
        {loggingOut ? u.accountOutBusy : u.accountOut}
      </button>
    </div>
  )
}

function SideNotes() {
  const { lang, copy } = useI18n()
  const u = copy.account.upload

  return (
    <aside className="upload-side" aria-label={u.sideAria}>
      <h2 className="upload-side-title">{u.sideTitle}</h2>
      <p className="upload-side-lede">{u.sideLede}</p>
      <ol className="upload-side-list">
        {u.sideItems.map((item, index) => (
          <li key={index}>
            <span className="upload-side-num" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <Rich parts={item} />
            </span>
          </li>
        ))}
      </ol>

      <h2 className="upload-side-sub">{u.sideSub}</h2>
      <p className="upload-side-text">{u.sideText}</p>
      <ol className="upload-side-stages" aria-label={u.sideStagesAria}>
        {TIERS.map((tier, index) => (
          <li key={tier.key}>
            {tierName(lang, tier.key)}
            {index < TIERS.length - 1 ? (
              <span className="upload-side-arrow" aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="upload-side-note">{u.sideNote}</p>

      <p className="upload-side-help">{u.sideHelp}</p>
      <a className="upload-side-link" href="/help">
        {u.sideLink}
      </a>
    </aside>
  )
}

export default function UploadPage() {
  const { copy } = useI18n()
  const u = copy.account.upload
  const [sessionState, setSessionState] = useState('loading')
  const [session, setSession] = useState(null)
  const [sessionError, setSessionError] = useState('')
  const [loginNotice, setLoginNotice] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  const [file, setFile] = useState(null)
  const [finished, setFinished] = useState(false)
  const [fileError, setFileError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [uploadState, setUploadState] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [successInfo, setSuccessInfo] = useState(null)
  const [dragging, setDragging] = useState(false)

  const inputRef = useRef(null)
  const dropRef = useRef(null)
  const successRef = useRef(null)
  const xhrRef = useRef(null)
  const shouldFocusDrop = useRef(false)

  useEffect(() => {
    loadSession()
    return () => {
      const xhr = xhrRef.current
      xhrRef.current = null
      xhr?.abort()
    }
  }, [])

  useEffect(() => {
    if (uploadState === 'success' && successRef.current) {
      successRef.current.focus()
    }
  }, [uploadState])

  useEffect(() => {
    if (uploadState !== 'idle' || !shouldFocusDrop.current) return
    shouldFocusDrop.current = false
    dropRef.current?.focus()
  }, [uploadState, session])

  const loadSession = async () => {
    setSessionState('loading')
    setSessionError('')

    try {
      const data = await getSession()
      const customer = customerFrom(data)
      if (!customer) {
        throw new ApiError(0, u.sessionMissing)
      }
      setSession(customer)
      setSessionState('ready')
    } catch (caught) {
      if (caught.status === 401) {
        setSession(null)
        setSessionState('ready')
        return
      }
      if (caught.status === 403) {
        setSession(null)
        setSessionState('ready')
        setLoginNotice(u.sessionDisabled)
        return
      }
      setSessionError(caught.message || u.sessionOffline)
      setSessionState('error')
    }
  }

  const handleLogin = (customer) => {
    setSession(customer)
    setSessionState('ready')
    setLoginNotice('')
    shouldFocusDrop.current = true
  }

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)

    try {
      await logout()
    } catch {
      // 服务端没回话也先退出本地，别把人卡在账号里。
    }

    setLoggingOut(false)
    setSession(null)
    setLoginNotice('')
    resetUpload()
  }

  const cancelUpload = () => {
    const xhr = xhrRef.current
    xhrRef.current = null
    xhr?.abort()
  }

  const resetUpload = () => {
    cancelUpload()
    setFile(null)
    setFinished(false)
    setFileError('')
    setUploadError('')
    setUploadState('idle')
    setProgress(0)
    setSuccessInfo(null)
    setDragging(false)
  }

  const acceptFile = (nextFile) => {
    if (!nextFile) return

    const error = validateFile(nextFile, copy)
    setUploadError('')

    if (error) {
      setFile(null)
      setFileError(error)
    } else {
      setFile(nextFile)
      setFileError('')
    }

    if (inputRef.current) inputRef.current.value = ''
  }

  const onInputChange = (event) => {
    acceptFile(event.target.files && event.target.files[0])
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    acceptFile(event.dataTransfer.files && event.dataTransfer.files[0])
  }

  const onDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDragging(false)
  }

  const canSubmit = Boolean(file && finished && uploadState !== 'uploading')

  const submitHint = () => {
    const hints = u.submitHints
    if (uploadState === 'uploading') return hints.uploading
    if (fileError || uploadError) return hints.error
    if (!file && !finished) return hints.empty
    if (!file) return hints.noFile
    if (!finished) return hints.noFinished
    return hints.ready
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!file || !finished || uploadState === 'uploading') return

    setUploadError('')
    setUploadState('uploading')
    setProgress(0)

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open('POST', `${API_BASE}/uploads`)

    xhr.upload.onprogress = (progressEvent) => {
      if (!progressEvent.lengthComputable) return
      setProgress(
        Math.round((progressEvent.loaded / progressEvent.total) * 100),
      )
    }

    xhr.onload = () => {
      xhrRef.current = null
      let data = null
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        data = null
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100)
        setSuccessInfo({ filename: file.name, size: file.size })
        setUploadState('success')
        return
      }

      setUploadState('idle')
      setProgress(0)

      if (xhr.status === 401 || xhr.status === 403) {
        setLoginNotice(
          xhr.status === 403 ? u.uploadDisabled : u.expired,
        )
        setSession(null)
        return
      }

      setUploadError(uploadErrorMessage(xhr.status, pickMessage(data), copy))
    }

    xhr.onerror = () => {
      if (xhrRef.current !== xhr) return
      xhrRef.current = null
      setUploadState('idle')
      setProgress(0)
      setUploadError(u.networkError)
    }

    xhr.onabort = () => {
      if (xhrRef.current !== xhr) return
      xhrRef.current = null
      setUploadState('idle')
      setProgress(0)
      setUploadError(u.aborted)
    }

    const body = new FormData()
    body.append('file', file)
    body.append('finished', 'true')
    xhr.send(body)
  }

  const handleReset = () => {
    resetUpload()
    shouldFocusDrop.current = true
  }

  return (
    <main id="main" className="page upload-page">
      <header className="page-head">
        <h1 className="page-title">{u.title}</h1>
        <p className="page-lede">{u.lede}</p>
      </header>

      <div className="upload-layout">
        <div className="upload-main">
          {sessionState === 'loading' ? (
            <p className="upload-loading" role="status">
              {u.confirmLogin}
            </p>
          ) : null}

          {sessionState === 'error' ? (
            <section className="upload-session-error" role="alert">
              <h2>{u.serverErrorTitle}</h2>
              <p>{sessionError}</p>
              <button
                className="upload-button upload-button-outline"
                type="button"
                onClick={loadSession}
              >
                {u.retry}
              </button>
            </section>
          ) : null}

          {sessionState === 'ready' && !session ? (
            <LoginPanel notice={loginNotice} onLogin={handleLogin} />
          ) : null}

          {sessionState === 'ready' && session ? (
            <>
              <AccountBar
                session={session}
                onLogout={handleLogout}
                loggingOut={loggingOut}
              />

              {uploadState === 'success' && successInfo ? (
                <section
                  className="upload-success"
                  ref={successRef}
                  tabIndex={-1}
                  aria-labelledby="upload-success-title"
                >
                  <h2
                    className="upload-success-title"
                    id="upload-success-title"
                  >
                    {u.successTitle}
                  </h2>
                  <p className="upload-success-lede">{u.successLede}</p>
                  <dl className="upload-success-meta">
                    <dt>{u.successFile}</dt>
                    <dd>
                      {successInfo.filename} ·{' '}
                      {formatSize(successInfo.size, copy)}
                    </dd>
                    <dt>{u.successStatus}</dt>
                    <dd>{u.successStatusValue}</dd>
                  </dl>
                  <div className="upload-success-actions">
                    <a
                      className="upload-button upload-button-primary"
                      href="/app/orders"
                    >
                      {u.successOrders}
                    </a>
                    <button
                      className="upload-button upload-button-outline"
                      type="button"
                      onClick={handleReset}
                    >
                      {u.successAgain}
                    </button>
                  </div>
                </section>
              ) : (
                <form
                  className="upload-form"
                  onSubmit={handleSubmit}
                  aria-busy={uploadState === 'uploading'}
                >
                  <button
                    className={`upload-drop${dragging ? ' is-drag' : ''}`}
                    type="button"
                    ref={dropRef}
                    onClick={() => inputRef.current?.click()}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setDragging(true)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragging(true)
                    }}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    disabled={uploadState === 'uploading'}
                  >
                    <span className="upload-drop-mark" aria-hidden="true">
                      ZIP
                    </span>
                    <span className="upload-drop-title">{u.dropTitle}</span>
                    <span className="upload-drop-sub">{u.dropSub}</span>
                    <span className="upload-drop-limit">{u.dropLimit}</span>
                  </button>

                  <input
                    ref={inputRef}
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    hidden
                    onChange={onInputChange}
                  />

                  {file ? (
                    <div className="upload-file">
                      <span className="upload-file-badge" aria-hidden="true">
                        ZIP
                      </span>
                      <div className="upload-file-main">
                        <p className="upload-file-name">{file.name}</p>
                        <p className="upload-file-size">
                          {formatSize(file.size, copy)}
                        </p>
                      </div>
                      <button
                        className="upload-file-replace"
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={uploadState === 'uploading'}
                      >
                        {u.fileReplace}
                      </button>
                    </div>
                  ) : null}

                  {fileError ? (
                    <p className="upload-error" role="alert">
                      {fileError}
                    </p>
                  ) : null}

                  {uploadError ? (
                    <p className="upload-error" role="alert">
                      {uploadError}
                    </p>
                  ) : null}

                  <div className="upload-check">
                    <label className="upload-check-label" htmlFor="upload-done">
                      <input
                        className="upload-check-input"
                        id="upload-done"
                        type="checkbox"
                        checked={finished}
                        onChange={(event) => setFinished(event.target.checked)}
                        disabled={uploadState === 'uploading'}
                        aria-describedby="upload-done-help"
                      />
                      <span>
                        <span className="upload-check-title">
                          {u.finishedTitle}
                        </span>
                        <span className="upload-check-help" id="upload-done-help">
                          {u.finishedHelp}
                        </span>
                      </span>
                    </label>
                    <p className="upload-check-note">{u.finishedNote}</p>
                  </div>

                  <div className="upload-privacy">
                    <p className="upload-privacy-title">{u.privacyTitle}</p>
                    <p className="upload-privacy-text">
                      <Rich parts={u.privacyText} />
                    </p>
                  </div>

                  <div className="upload-submit">
                    <button
                      className="upload-button upload-button-primary"
                      type="submit"
                      disabled={!canSubmit}
                    >
                      {uploadState === 'uploading' ? u.submitting : u.submit}
                    </button>
                    <p className="upload-submit-hint" role="status">
                      {submitHint()}
                    </p>
                  </div>

                  {uploadState === 'uploading' ? (
                    <div className="upload-progress-wrap">
                      <div
                        className="upload-meter"
                        role="progressbar"
                        aria-label={u.progressAria}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                      <p className="upload-progress">
                        {progress >= 100
                          ? u.progressDone
                          : u.progress(progress)}
                      </p>
                    </div>
                  ) : null}
                </form>
              )}
            </>
          ) : null}
        </div>

        <SideNotes />
      </div>
    </main>
  )
}
