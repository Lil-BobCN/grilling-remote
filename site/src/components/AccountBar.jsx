import { useState } from 'react'

export default function AccountBar({ session, onLogout }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = session?.displayName || session?.email || ''

  const handleLogout = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onLogout()
    } catch {
      setError('退出没成功，再试一次。')
      setBusy(false)
    }
  }

  return (
    <div className="account-bar">
      {name ? <span className="account-who">{name}</span> : null}
      <button
        className="account-logout"
        type="button"
        onClick={handleLogout}
        disabled={busy}
      >
        {busy ? '正在退出…' : '退出'}
      </button>
      {error ? (
        <p className="account-bar-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
