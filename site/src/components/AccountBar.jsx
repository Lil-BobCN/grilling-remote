import { useState } from 'react'
import { useI18n } from '../i18n/index.jsx'

export default function AccountBar({ session, onLogout }) {
  const { copy } = useI18n()
  const bar = copy.account.bar
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
      setError(bar.logoutFailed)
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
        {busy ? bar.loggingOut : bar.logout}
      </button>
      {error ? (
        <p className="account-bar-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
