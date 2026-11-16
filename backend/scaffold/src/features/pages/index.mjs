/**
 * 页面渲染。改样子改这里。
 */
export function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value).replace(/[&<>"']/g, (char) => map[char])
}

function layout(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; --ink: #23201b; --muted: #6d665c; --line: #e4ddd2; --accent: #2f6f4e; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #faf7f2; color: var(--ink); font: 16px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 40px 20px 64px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  .lead { color: var(--muted); margin: 0 0 28px; }
  section { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  h2 { font-size: 17px; margin: 0 0 12px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--line); }
  li:last-child { border-bottom: 0; }
  .sold { color: var(--muted); text-decoration: line-through; }
  label { display: block; font-weight: 600; margin: 14px 0 6px; }
  input, select { width: 100%; padding: 10px 12px; font: inherit; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
  button { margin-top: 18px; width: 100%; padding: 12px; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }
  button:disabled { background: var(--muted); cursor: not-allowed; }
  .ok { font-size: 22px; font-weight: 700; color: var(--accent); margin: 0 0 12px; }
  dl { display: grid; grid-template-columns: 80px 1fr; gap: 8px 12px; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; font-weight: 600; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`
}

function itemsHtml(items) {
  if (!items.length) return '<li>今天没有可订的货。</li>'
  return items
    .map((item) => {
      const name = item.soldOut ? `<span class="sold">${escapeHtml(item.name)}</span>` : escapeHtml(item.name)
      const tail = item.soldOut ? '卖完了' : `¥${escapeHtml(item.price)} / ${escapeHtml(item.unit)}`
      return `<li><span>${name}</span><span>${tail}</span></li>`
    })
    .join('')
}

function slotsHtml(slots) {
  const open = slots.filter((slot) => !slot.full)
  if (!open.length) return '<p>今天的时段都满了。</p>'
  return `<select id="slotId" name="slotId">${open
    .map(
      (slot) =>
        `<option value="${escapeHtml(slot.id)}">${escapeHtml(slot.label)}（剩 ${escapeHtml(slot.remaining)} 位）</option>`,
    )
    .join('')}</select>`
}

export function renderHome({ product, items, slots }) {
  const canOrder = slots.some((slot) => !slot.full)
  return layout(
    product,
    `<h1>${escapeHtml(product)}</h1>
<p class="lead">看今天有什么，选个时间来拿。</p>
<section>
  <h2>今天有</h2>
  <ul>${itemsHtml(items)}</ul>
</section>
<section>
  <h2>下个单</h2>
  <form method="post" action="/orders">
    <label for="phone">手机号</label>
    <input id="phone" name="phone" inputmode="numeric" placeholder="11 位手机号" required>
    <label for="slotId">取货时间</label>
    ${slotsHtml(slots)}
    <button type="submit"${canOrder ? '' : ' disabled'}>订好了通知我</button>
  </form>
</section>`,
  )
}

export function renderOrder(order) {
  return layout(
    '订好了',
    `<p class="ok">订好了</p>
<p class="lead">到时间直接来拿，报手机号就行。</p>
<section>
  <dl>
    <dt>单号</dt><dd>${escapeHtml(order.id)}</dd>
    <dt>取货时间</dt><dd>${escapeHtml(order.slotLabel)}</dd>
    <dt>手机号</dt><dd>${escapeHtml(order.phone)}</dd>
  </dl>
</section>
<p><a href="/">再订一单</a></p>`,
  )
}

export function renderError(title, message) {
  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1>
<p class="lead">${escapeHtml(message)}</p>
<p><a href="/">回首页</a></p>`,
  )
}
