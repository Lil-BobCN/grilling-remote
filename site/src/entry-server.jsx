import { renderToString } from 'react-dom/server'
import App from './App.jsx'

export function renderPage(page) {
  return renderToString(<App page={page} />)
}
