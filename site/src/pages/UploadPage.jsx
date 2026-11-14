import { useEffect, useRef, useState } from 'react'
import '../styles/upload.css'

/*
 * 账号接口经裸域 /app/api/* 反代到独立服务。
 * 字段和错误码归 I-0035；这里只依赖最小字段，服务端改了只改这一段：
 *   GET  /app/api/session  -> { customer: { short_name, display_name, email } }，没登录回 401
 *   POST /app/api/login    <- { email, password }，成功回同一份 customer
 *   POST /app/api/logout
 *   POST /app/api/uploads  <- multipart：file、finished=true
 */
const API_BASE = '/app/api'
const MAX_BYTES = 50 * 1024 * 1024

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function pickMessage(data) {
  if (!data || typeof data !== 'object') return ''
  const value = data.message ?? data.error
  return typeof value === 'string' ? value : ''
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function getJson(path) {
  let response

  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, '没连上服务器，检查网络后再试。')
  }

  const data = await readJson(response)
  if (!response.ok) throw new ApiError(response.status, pickMessage(data))
  return data
}

async function postJson(path, body) {
  const options = {
    method: 'POST',
    credentials: 'same-origin',
  }

  if (body !== undefined) {
    options.headers = { 'content-type': 'application/json' }
    options.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(`${API_BASE}${path}`, options)
  } catch {
    throw new ApiError(0, '没连上服务器，检查网络后再试。')
  }

  const data = await readJson(response)
  if (!response.ok) throw new ApiError(response.status, pickMessage(data))
  return data
}

function customerFrom(data) {
  const customer = data && data.customer
  if (!customer || !customer.email) return null

  return {
    name: customer.display_name || customer.short_name || customer.email,
    email: customer.email,
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function validateFile(file) {
  if (!/\.zip$/i.test(file.name)) {
    return '只收 .zip。把整个工作区文件夹压成一个 zip 再选。'
  }
  if (file.size === 0) {
    return '这个文件是空的。重新压一次再选。'
  }
  if (file.size > MAX_BYTES) {
    return `这个包 ${formatSize(file.size)}，超过 50 MB 上限。删掉不需要的文件，重新压缩后再传。`
  }
  return ''
}

function uploadErrorMessage(status, message) {
  if (message) return message
  if (status === 413) {
    return '包太大了，服务器没收下。确认压缩包在 50 MB 以内，再传一次。'
  }
  if (status === 415) {
    return '服务器不收这个格式。只传 .zip。'
  }
  if (status === 400 || status === 422) {
    return '服务器没通过这个包。看看提示，改好再传。'
  }
  if (status >= 500) {
    return '服务器出错了。等一会儿再试；一直不行就找客服。'
  }
  return '上传没成功。稍后再试；一直不行就找客服。'
}

function LoginPanel({ notice, onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return

    const trimmed = email.trim()
    if (!trimmed || !password) {
      setError('邮箱和密码都要填。')
      return
    }
    if (!trimmed.includes('@')) {
      setError('邮箱看着不对，检查一下。')
      return
    }

    setBusy(true)
    setError('')

    try {
      const data = await postJson('/login', {
        email: trimmed.toLowerCase(),
        password,
      })
      const customer = customerFrom(data)
      if (!customer) {
        throw new ApiError(0, '登录成功了，但账号信息没读出来。刷新页面再试。')
      }
      onLogin(customer)
    } catch (caught) {
      if (caught.status === 401) {
        setError('邮箱或密码不对。再试一次，或找客服。')
      } else if (caught.status === 403) {
        setError('这个账号已停用，找客服。')
      } else {
        setError(caught.message || '登录没成功，稍后再试。')
      }
      setBusy(false)
    }
  }

  return (
    <form className="upload-login" onSubmit={submit} noValidate>
      <h2 className="upload-login-title">先登录</h2>
      <p className="upload-login-sub">
        用我们发给你的邮箱和密码。账号由我们开通，忘了密码找客服。
      </p>

      {notice ? (
        <p className="upload-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="upload-field">
        <label htmlFor="upload-email">邮箱</label>
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
        <label htmlFor="upload-password">密码</label>
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
          {busy ? '正在登录…' : '登录'}
        </button>
        <a className="upload-help-link" href="/tutorial#support">
          忘了密码？找客服
        </a>
      </div>
    </form>
  )
}

function AccountBar({ session, onLogout, loggingOut }) {
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
        {loggingOut ? '正在退出…' : '退出登录'}
      </button>
    </div>
  )
}

const STAGES = ['已收到', '安排中', '开发中', '待客户验收', '已完成']

function SideNotes() {
  return (
    <aside className="upload-side" aria-label="上传前后要注意的事">
      <h2 className="upload-side-title">传之前，检查三件事</h2>
      <p className="upload-side-lede">压错了，我们会让你补传。</p>
      <ol className="upload-side-list">
        <li>
          <span className="upload-side-num" aria-hidden="true">
            1
          </span>
          <span>
            压的是整个工作区文件夹，不是只压 <code className="upload-side-code">.scratch/</code>。
          </span>
        </li>
        <li>
          <span className="upload-side-num" aria-hidden="true">
            2
          </span>
          <span>
            文件夹里有 <code className="upload-side-code">AGENTS.md</code> 和 <code className="upload-side-code">.scratch/</code>。
          </span>
        </li>
        <li>
          <span className="upload-side-num" aria-hidden="true">
            3
          </span>
          <span>压缩包在 50 MB 以内。超了先删掉不需要的文件，再压一次。</span>
        </li>
      </ol>

      <h2 className="upload-side-sub">传上来之后</h2>
      <p className="upload-side-text">
        我们先校验，再建单、安排处理。进度在「我的订单」看，不用催。
      </p>
      <ol className="upload-side-stages" aria-label="五档进度">
        {STAGES.map((stage, index) => (
          <li key={stage}>
            {stage}
            {index < STAGES.length - 1 ? (
              <span className="upload-side-arrow" aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="upload-side-note">
        校验没通过时，我们会说缺什么、怎么补，补好再传一次。
      </p>

      <p className="upload-side-help">
        卡在这一步？截一张屏幕，把窗口边框和报错带上，发给客服。微信为主，电话兜底。
      </p>
      <a className="upload-side-link" href="/tutorial#support">
        怎么找客服 →
      </a>
    </aside>
  )
}

export default function UploadPage() {
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
      const data = await getJson('/session')
      const customer = customerFrom(data)
      if (!customer) {
        throw new ApiError(0, '账号信息没读出来，刷新页面再试。')
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
        setLoginNotice('这个账号已停用，找客服。')
        return
      }
      setSessionError(caught.message || '没连上服务器，稍后再试。')
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
      await postJson('/logout')
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

    const error = validateFile(nextFile)
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
    if (uploadState === 'uploading') return '正在上传，别关页面。'
    if (fileError || uploadError) return '看上面的提示，改好再选一次。'
    if (!file && !finished) return '选一个 zip，再勾上「已问完」。'
    if (!file) return '还要选一个 zip。'
    if (!finished) return '还差一步：勾上「已问完」。'
    return '可以上传了。'
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
          xhr.status === 403
            ? '这个账号已停用，传不上去。找客服。'
            : '登录过期了，重新登录后再传。文件还在。',
        )
        setSession(null)
        return
      }

      setUploadError(uploadErrorMessage(xhr.status, pickMessage(data)))
    }

    xhr.onerror = () => {
      if (xhrRef.current !== xhr) return
      xhrRef.current = null
      setUploadState('idle')
      setProgress(0)
      setUploadError('没连上服务器。文件还在，检查网络后再点一次上传。')
    }

    xhr.onabort = () => {
      if (xhrRef.current !== xhr) return
      xhrRef.current = null
      setUploadState('idle')
      setProgress(0)
      setUploadError('上传停了。文件还在，可以再点一次。')
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
        <h1 className="page-title">上传工作区</h1>
        <p className="page-lede">
          全部问完，把整个工作区压成一个 zip 传回来。简称和邮箱由账号带出，不用再填。
        </p>
      </header>

      <div className="upload-layout">
        <div className="upload-main">
          {sessionState === 'loading' ? (
            <p className="upload-loading" role="status">
              正在确认登录状态…
            </p>
          ) : null}

          {sessionState === 'error' ? (
            <section className="upload-session-error" role="alert">
              <h2>没连上服务器</h2>
              <p>{sessionError}</p>
              <button
                className="upload-button upload-button-outline"
                type="button"
                onClick={loadSession}
              >
                重试
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
                    传上来了。
                  </h2>
                  <p className="upload-success-lede">
                    我们在校验，接下来会安排处理。进度在「我的订单」看，不用再传一次。
                  </p>
                  <dl className="upload-success-meta">
                    <dt>文件</dt>
                    <dd>
                      {successInfo.filename} · {formatSize(successInfo.size)}
                    </dd>
                    <dt>状态</dt>
                    <dd>已收到 · 校验中</dd>
                  </dl>
                  <div className="upload-success-actions">
                    <a
                      className="upload-button upload-button-primary"
                      href="/app/orders"
                    >
                      看订单进度
                    </a>
                    <button
                      className="upload-button upload-button-outline"
                      type="button"
                      onClick={handleReset}
                    >
                      再传一个
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
                    <span className="upload-drop-title">把 zip 拖到这里</span>
                    <span className="upload-drop-sub">或点这里选择文件</span>
                    <span className="upload-drop-limit">
                      只收 .zip · 50 MB 以内
                    </span>
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
                          {formatSize(file.size)}
                        </p>
                      </div>
                      <button
                        className="upload-file-replace"
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={uploadState === 'uploading'}
                      >
                        换一个
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
                        <span className="upload-check-title">已问完</span>
                        <span className="upload-check-help" id="upload-done-help">
                          全部问完、agent 说没有下一张票了，再勾。
                        </span>
                      </span>
                    </label>
                    <p className="upload-check-note">
                      勾上「已问完」，我们才开始处理这个包。
                    </p>
                  </div>

                  <div className="upload-privacy">
                    <p className="upload-privacy-title">
                      文件夹里的所有文件都会上传，请只放本项目的资料。
                    </p>
                    <p className="upload-privacy-text">
                      对话记录在 <code>~/.dsh/sessions/</code>
                      ，不在工作区里，不会跟着上传。
                    </p>
                  </div>

                  <div className="upload-submit">
                    <button
                      className="upload-button upload-button-primary"
                      type="submit"
                      disabled={!canSubmit}
                    >
                      {uploadState === 'uploading' ? '上传中…' : '上传'}
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
                        aria-label="上传进度"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                      <p className="upload-progress">
                        {progress >= 100
                          ? '传完了，等服务器回话…'
                          : `正在上传 ${progress}%`}
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
