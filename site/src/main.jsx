import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/tokens.css'
import './styles/base.css'
import './styles/motion.css'

const container = document.getElementById('root')
const page = container.dataset.page

function mount(node) {
  container.textContent = ''
  const root = createRoot(container)
  flushSync(() => root.render(<StrictMode>{node}</StrictMode>))
  document.documentElement.classList.remove('lang-pending')
}

if (page === 'app') {
  // 账号区不预渲染，按需加载；公开页不为它背账号和订单的代码与样式。
  import('./pages/AccountApp.jsx')
    .then(({ default: AccountApp }) => mount(<AccountApp />))
    .catch(() => document.documentElement.classList.remove('lang-pending'))
} else {
  // 预渲染的是中文；存过英文的人直接换成客户端渲染，避免水合结果对不上。
  const english = document.documentElement.getAttribute('data-lang') === 'en'
  const hasMarkup = Boolean(container.firstElementChild)
  const tree = <App page={page} />

  if (hasMarkup && !english) {
    hydrateRoot(container, <StrictMode>{tree}</StrictMode>)
  } else {
    mount(tree)
  }
}
