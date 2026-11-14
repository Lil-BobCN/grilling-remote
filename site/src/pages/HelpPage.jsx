import PageShell from '../components/PageShell.jsx'
import '../styles/help.css'

const stuck = [
  {
    label: '下载',
    text: '下到一半停了，或文件名后面多了个 (1)。',
    href: '/tutorial#step-1',
    link: '去第 1 步',
  },
  {
    label: '解压',
    text: '解压后看不到 AGENTS.md，或文件夹里还套着一层文件夹。',
    href: '/tutorial#step-2',
    link: '去第 2 步',
  },
  {
    label: '第一次对话',
    text: 'agent 没反应，或说文件没放对。',
    href: '/tutorial#first-chat',
    link: '去第一次对话',
  },
  {
    label: '上传',
    text: '压缩包传不上去，或提示超过 50 MB。',
    href: '/tutorial#upload',
    link: '去回传这一步',
  },
  {
    label: '登录和订单',
    text: '密码忘了，或订单页一直打不开。',
    href: '/app/orders',
    link: '去订单页',
  },
]

export default function HelpPage() {
  return (
    <PageShell
      path="/help"
      title="帮助与客服"
      lede="卡住了先别重装。把三样发过来，我们接着看。"
      scaffold={false}
      className="help-page"
    >
      <section
        className="help-contact"
        aria-labelledby="help-contact-title"
        data-reveal
      >
        <div className="help-qr">
          <div className="help-qr-slot" aria-hidden="true">
            <span>二维码</span>
            <span>上线前补</span>
          </div>
          <p className="help-qr-note">
            微信号也上线前补。先用签约时对接你的那个人。
          </p>
        </div>
        <div className="help-contact-body">
          <h2 id="help-contact-title">微信找签约时对接你的那个人</h2>
          <p>
            微信为主，电话兜底。有事先微信找我们；没回就是在忙或睡了，看到会回。
          </p>
          <p className="help-contact-note">
            语气不用客气，说清楚就行。「我在上传页，传 zip
            时提示超过 50 MB，截图在下面。」这一句就够。
          </p>
        </div>
      </section>

      <section
        className="help-send"
        aria-labelledby="help-send-title"
        data-reveal="panel"
      >
        <div className="help-send-grid">
          <div>
            <h2 id="help-send-title">发这三样</h2>
            <ol className="help-list">
              <li>卡在哪个页面、点哪个按钮时出的问题；订单问题加上订单名。</li>
              <li>一张屏幕截图，把窗口边框和报错带上。</li>
              <li>页面上的那句话，能复制就复制过来。</li>
            </ol>
          </div>
          <div>
            <h2>先别做这些</h2>
            <ul className="help-list">
              <li>不要自己删文件、重装 dsh、换文件夹。</li>
              <li>不要重复下载很多次，先看一眼报错。</li>
              <li>不要把工作区发给别人，里面有你的需求。</li>
            </ul>
          </div>
        </div>
      </section>

      <section
        className="help-stuck"
        aria-labelledby="help-stuck-title"
        data-reveal
      >
        <h2 id="help-stuck-title">常见卡点</h2>
        <p className="help-stuck-lede">
          先对一下是不是这几处。能自己回到对应那一步，就不用发消息。
        </p>
        <dl className="help-stuck-list">
          {stuck.map((item) => (
            <div className="help-stuck-row" key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                <span>{item.text}</span>
                <a href={item.href}>{item.link} →</a>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className="help-next"
        aria-labelledby="help-next-title"
        data-reveal="panel"
      >
        <div>
          <h2 id="help-next-title">下一步</h2>
          <p>装的时候卡住，回到教程对应那一步；交回之后有问题，去订单页。</p>
        </div>
        <div className="help-next-actions">
          <a className="help-next-link" href="/tutorial">
            看教程 →
          </a>
          <a className="help-next-link help-next-link-quiet" href="/app/orders">
            我的订单
          </a>
        </div>
      </section>
    </PageShell>
  )
}
