import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App.jsx'
import AccountApp from './pages/AccountApp.jsx'
import './styles/tokens.css'
import './styles/base.css'

const container = document.getElementById('root')
const page = container.dataset.page
const tree = page === 'app' ? <AccountApp /> : <App page={page} />

if (container.firstElementChild) {
  hydrateRoot(container, <StrictMode>{tree}</StrictMode>)
} else {
  createRoot(container).render(<StrictMode>{tree}</StrictMode>)
}
