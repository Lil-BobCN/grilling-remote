import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App.jsx'
import AccountApp from './pages/AccountApp.jsx'
import './styles/tokens.css'
import './styles/base.css'
import './styles/motion.css'

const container = document.getElementById('root')
const page = container.dataset.page
const tree = page === 'app' ? <AccountApp /> : <App page={page} />

// 预渲染的是中文；存过英文的人直接换成客户端渲染，避免水合结果对不上。
const english = document.documentElement.getAttribute('data-lang') === 'en'
const hasMarkup = Boolean(container.firstElementChild)

if (hasMarkup && !english) {
  hydrateRoot(container, <StrictMode>{tree}</StrictMode>)
} else {
  container.textContent = ''
  const root = createRoot(container)
  flushSync(() => root.render(<StrictMode>{tree}</StrictMode>))
  document.documentElement.classList.remove('lang-pending')
}
