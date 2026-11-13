import { useEffect } from 'react'
import PageShell from '../components/PageShell.jsx'
import SiteLayout from '../components/SiteLayout.jsx'

const routes = [
  {
    matches: (path) => path === '/app',
    current: null,
    title: '登录',
    lede: '用邮箱登录，查看订单和上传工作区。',
  },
  {
    matches: (path) => path === '/app/upload',
    current: 'upload',
    title: '上传工作区',
    lede: '把做完的整个文件夹压成 zip，登录后传回来。',
  },
  {
    matches: (path) => path === '/app/orders',
    current: 'orders',
    title: '我的订单',
    lede: '五档进度，每一档都写清楚下一步。',
    demoOrder: true,
  },
  {
    matches: (path) => /^\/app\/orders\/[^/]+$/.test(path),
    current: 'orders',
    title: '订单详情',
    lede: '这一单的进度和每一步的说明。',
  },
]

function normalizePath() {
  const path = window.location.pathname.replace(/\/index\.html$/, '')
  return path.length > 1 ? path.replace(/\/+$/, '') : path || '/'
}

export default function AccountApp() {
  const path = normalizePath()
  const route = routes.find((item) => item.matches(path))
  const title = route ? route.title : '页面不存在'
  const lede = route ? route.lede : '地址不对。回首页，或者去看订单。'

  useEffect(() => {
    document.title = `${title} · afkfactory`
  }, [title])

  return (
    <SiteLayout help={false} current={route ? route.current : null}>
      <PageShell path={path} title={title} lede={lede}>
        {route && route.demoOrder ? (
          <p className="scaffold-note">
            <a href="/app/orders/demo">打开示例订单 →</a>
          </p>
        ) : null}
        {route ? null : (
          <p className="scaffold-note">
            <a href="/">回首页</a> · <a href="/app/orders">我的订单</a>
          </p>
        )}
      </PageShell>
    </SiteLayout>
  )
}
