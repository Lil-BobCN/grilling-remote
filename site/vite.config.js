import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))

const publicAliases = new Map([
  ['/download', '/download.html'],
  ['/skills', '/skills.html'],
  ['/tutorial', '/tutorial.html'],
])

/**
 * 线上由 Caddy 用 try_files 把 /download 映射到 download.html，
 * 账号区回退到 app/index.html。开发和预览时用同一套规则，
 * 避免本地地址和线上地址不一致。
 */
function cleanUrls() {
  function middleware(req, _res, next) {
    const url = req.url || '/'
    const [rawPathname, search] = url.split('?')
    const suffix = search ? `?${search}` : ''
    const pathname = rawPathname.length > 1 ? rawPathname.replace(/\/+$/, '') : rawPathname

    if (publicAliases.has(pathname)) {
      req.url = publicAliases.get(pathname) + suffix
      return next()
    }

    const isAccountPath =
      pathname === '/app' ||
      (pathname.startsWith('/app/') &&
        !pathname.startsWith('/app/api/') &&
        !pathname.endsWith('.html') &&
        !pathname.includes('.'))

    if (isAccountPath) {
      req.url = '/app/index.html' + suffix
    }

    next()
  }

  return {
    name: 'afkfactory-clean-urls',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  appType: 'mpa',
  plugins: [react(), cleanUrls()],
  // 下载页要读仓库根的 customer-kit/release.json，开发服务器放行上一级
  server: {
    fs: {
      allow: [resolve(root, '..')],
    },
  },
  build: {
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        download: resolve(root, 'download.html'),
        skills: resolve(root, 'skills.html'),
        tutorial: resolve(root, 'tutorial.html'),
        app: resolve(root, 'app/index.html'),
      },
    },
  },
})
