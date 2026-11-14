import release from '../../../customer-kit/release.json'

export default function SiteFooter({ help = true }) {
  return (
    <footer className="site-footer" data-reveal>
      {help ? (
        <a className="footer-help" href="/help">
          帮助与客服
        </a>
      ) : null}
      <div className="footer-links">
        <a href="/download">下载</a>
        <a href="/skills">技能清单</a>
        <a href="/tutorial">教程</a>
        <a href="/app/upload">上传</a>
        <a href="/app">登录</a>
        <a href="/app/orders">我的订单</a>
      </div>
      <p className="footer-meta">
        {release.version} · {release.date} · afkfactory.dev
      </p>
    </footer>
  )
}
