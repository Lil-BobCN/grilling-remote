/**
 * 模拟环境的夹具：三张假父工单的需求包、地图、决定票和假 spec。
 *
 * 内容按 `docs/客户工作区.md` 的回传件格式写，够 `gap.mjs apply-map`、
 * `gap.mjs propose`、`gap.mjs point` 和拆票 brief 跑通。不碰真实客户。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const SIM_OWNER = 'Lil-BobCN'
export const SIM_REPO = 'scratch-bot-sim'

/**
 * 三张假父工单：
 * - gap：已提交、没有提案，一轮调度里走补充缺口。
 * - split：排队中、有假 spec、没有子票，走拆票。
 * - ignite：排队中、已点头拆票、有一张排队中的子票，走到点火。
 */
export const SIM_REQUIREMENTS = [
  {
    key: 'gap',
    orderId: 'o-sim-0001',
    uploadId: 'upload-sim-0001',
    requirement: 'yuyue-kafei',
    product: 'yuyue-kafei',
    customer: '模拟咖啡店',
    parentTitle: '咖啡店预约取货',
    quote: '顾客想在线预约取货，到店报名字拿。',
    conclusion: '取货时间按半小时一格，客户自己选。',
    acceptance: ['顾客打开链接，选一个取货时间。', '店里看到当天的预约名单。'],
    outOfScope: '在线支付',
    decisionTitle: '配送范围怎么定',
    decisionFile: '01-配送范围怎么定.md',
    decisionQuestion: '配送只送镇上还是全城？',
    pendingQuestion: '小程序部署到哪家云？',
    pendingRecommended: '用默认技术栈，部署到我们管理的香港服务器。',
    pendingTag: '客户不懂',
  },
  {
    key: 'split',
    orderId: 'o-sim-0002',
    uploadId: 'upload-sim-0002',
    requirement: 'baoxiu-gongdan',
    product: 'baoxiu-gongdan',
    customer: '模拟五金店',
    parentTitle: '门店报修工单',
    quote: '店里东西坏了要能报修，师傅上门。',
    conclusion: '报修单先拍照片，再填一句话。',
    acceptance: ['店员提交报修单，表单里带一张照片。', '师傅在列表里看到新报修单。'],
    outOfScope: '自动派单',
    decisionTitle: '照片存哪',
    decisionFile: '01-照片存哪.md',
    decisionQuestion: '照片存本地还是对象存储？',
    pendingQuestion: '报修单要不要短信通知？',
    pendingRecommended: '先不发短信，站内列表够用。',
    pendingTag: '客户不懂',
  },
  {
    key: 'ignite',
    orderId: 'o-sim-0003',
    uploadId: 'upload-sim-0003',
    requirement: 'pandian-qingdan',
    product: 'pandian-qingdan',
    customer: '模拟杂货店',
    parentTitle: '库存盘点清单',
    quote: '每月盘一次货，要能导出清单。',
    conclusion: '盘点按货架分区做。',
    acceptance: ['店员按货架填盘点数。', '店长导出一张盘点清单。'],
    outOfScope: '条码扫描',
    decisionTitle: '盘点周期',
    decisionFile: '01-盘点周期.md',
    decisionQuestion: '多久盘一次？',
    pendingQuestion: '盘点结果要不要同步到财务？',
    pendingRecommended: '先不同步，导出表格交给财务。',
    pendingTag: '客户不懂',
  },
]

export function requirementByKey(key) {
  const found = SIM_REQUIREMENTS.find((row) => row.key === key)
  if (!found) throw new Error(`没有这张假需求：${key}`)
  return found
}

export function buildParentBody(def, { owner = SIM_OWNER, repo = SIM_REPO } = {}) {
  return [
    '## 客户原话',
    '',
    `> 「${def.quote}」`,
    '',
    '## 客户确认的结论',
    '',
    `- ${def.conclusion}`,
    '',
    '## 验收条件',
    '',
    ...def.acceptance.map((item) => `- [ ] ${item}`),
    '',
    '## 不做清单',
    '',
    `- ${def.outOfScope}`,
    '',
    '## 需求全文',
    '',
    `- 客户简称：${def.customer}`,
    `- 需求名：${def.requirement}`,
    `- 全文：https://github.com/${owner}/${repo}/tree/main/docs/requirements/${def.requirement}/`,
    '',
    `<!-- factory:order=${def.orderId} -->`,
  ].join('\n')
}

export function buildMapMd(def) {
  return [
    `# ${def.parentTitle} 地图`,
    '',
    '## Destination',
    '',
    def.conclusion,
    '',
    '## Notes',
    '',
    `- 客户简称：${def.customer}`,
    '',
    '## 接下来',
    '',
    `- 1 ${def.decisionTitle}`,
    '',
    '## Decisions so far',
    '',
    `- ${def.conclusion}`,
    '',
    '## Not yet specified',
    '',
    '## Out of scope',
    '',
    `- ${def.outOfScope}`,
  ].join('\n')
}

export function buildDecisionTicket(def) {
  return {
    file: def.decisionFile,
    text: [
      `# 01 ${def.decisionTitle}`,
      '',
      'Type: grilling',
      'Status: open',
      'Blocked by:',
      '',
      '## Question',
      '',
      def.decisionQuestion,
      '',
      '## 评论',
      '',
      '客户提过一句，先按默认做。',
      '',
      '## 结论',
      '',
      '（做完才写）',
    ].join('\n'),
  }
}

export function buildPendingMd(def) {
  return [
    `## 1 ${def.pendingQuestion}`,
    '',
    `- 题目原文：${def.pendingQuestion}`,
    `- 推荐答案：${def.pendingRecommended}`,
    `- 标签：${def.pendingTag}`,
  ].join('\n')
}

export function buildAcceptanceScenarios(def) {
  return [
    '客户确认：2026-11-24',
    '',
    ...def.acceptance.map((item) => `- ${item}`),
  ].join('\n')
}

export function buildDecisionRecord(def) {
  return ['# 决策记录', '', `- 2026-11-24：${def.conclusion}`].join('\n')
}

export function buildSpec(def) {
  return {
    title: `规格：${def.parentTitle}（${def.requirement}）`,
    body: [
      `需求名：${def.requirement}`,
      '',
      '## 范围',
      '',
      def.quote,
      '',
      '## 验收条件',
      '',
      ...def.acceptance.map((item) => `- [ ] ${item}`),
      '',
      '## 不做',
      '',
      `- ${def.outOfScope}`,
    ].join('\n'),
  }
}

export function buildMeta(def, { owner = SIM_OWNER, repo = SIM_REPO, issueUrl = '' } = {}) {
  return {
    id: def.uploadId,
    status: 'imported',
    orders: [def.orderId],
    requirements: [{ name: def.requirement, passed: true }],
    imported: [
      {
        order_id: def.orderId,
        requirement: def.requirement,
        product: def.product,
        owner,
        repo,
        issue_url: issueUrl,
        branch: `req/${def.orderId}`,
      },
    ],
  }
}

/**
 * 写一个假回传件：`inbox/<上传 id>/meta.json` 和 `.scratch/<需求名>/`。
 * 返回实际路径，供 `gap.mjs apply-map` 和拆票 brief 用。
 */
export async function writeInboxPackage({
  root,
  def,
  owner = SIM_OWNER,
  repo = SIM_REPO,
  issueUrl = '',
}) {
  const uploadDir = join(root, 'inbox', def.uploadId)
  const scratchDir = join(uploadDir, '.scratch', def.requirement)
  await mkdir(join(scratchDir, 'issues'), { recursive: true })
  const decision = buildDecisionTicket(def)
  const files = {
    'map.md': buildMapMd(def),
    'pending.md': buildPendingMd(def),
    '验收场景.md': buildAcceptanceScenarios(def),
    '决策记录.md': buildDecisionRecord(def),
    [join('issues', decision.file)]: decision.text,
  }
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(scratchDir, name), `${text}\n`, 'utf8')
  }
  const meta = buildMeta(def, { owner, repo, issueUrl })
  const metaPath = join(uploadDir, 'meta.json')
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  return { uploadDir, scratchDir, metaPath, meta }
}
