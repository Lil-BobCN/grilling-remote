/**
 * 订单进度：把转档评论行还原成客户看到的五档和小步骤。
 * 行格式见 prototype/issue-109/README.md 的「转档状态：结论」。
 *
 * 页面只认 `进度 v1｜…` 开头的行；其它评论不算转档。
 */

export const TIERS = [
  {
    key: '已收到',
    short: '文件夹收到了，先检查齐不齐。',
    intro: '我们已经收到你传的文件夹，正在看里面的东西齐不齐。',
    next: '检查通过后，就进「安排中」。',
    subs: [
      { key: '收包', label: '收到你传的文件夹', desc: '文件已经存好，不会丢。' },
      { key: '校验', label: '检查文件齐不齐', desc: '看有没有缺东西、格式对不对。' },
    ],
  },
  {
    key: '安排中',
    short: '排成能开工的工单。',
    intro: '我们在把这件事安排成能开工的工单。这一步不用你做什么。',
    next: '确认完就动工，进「开发中」。',
    subs: [
      { key: '建单', label: '建立这张单', desc: '把需求登记成一张工单。' },
      {
        key: '技术闸门',
        label: '确认技术选项',
        desc: '运营者确认服务器、账号这些技术选择。',
      },
      {
        key: '写规格',
        label: '写清要做什么',
        desc: '把你的要求写成开发能照着做的说明。',
      },
      {
        key: '拆票',
        label: '拆成能开工的几块',
        desc: '分成几块小活，方便并行做。',
      },
      { key: '点头', label: '运营者最后确认', desc: '确认拆出来的活没有漏。' },
    ],
  },
  {
    key: '开发中',
    short: '一块一块做。',
    intro: '正在做。每做完一块，进度会往前挪一点。',
    next: '做完这一档，就进「待客户验收」，会微信告诉你。',
    subs: [
      { key: '开工', label: '开始动工', desc: '把这一轮的活排进队列。' },
      {
        key: '子票开发',
        label: '一块一块做',
        desc: '一块一块做，做完一块检查一块。',
      },
      { key: '验证', label: '自动检查', desc: '跑一遍检查，看有没有把原来的功能弄坏。' },
      { key: '评审', label: '人工检查', desc: '再看一遍做好的东西和效果。' },
      {
        key: '合分支',
        label: '合并这一轮的改动',
        desc: '把这一轮做的几块合成一份。',
      },
      { key: '合主干', label: '并进正式版本', desc: '把这一轮的改动放进正式版本。' },
      { key: '部署', label: '放到线上', desc: '放上去，准备给你试。' },
    ],
  },
  {
    key: '待客户验收',
    short: '你试一下，有问题直接说。',
    intro: '做好了，地址和试用清单已经发给你。你试完说一声就行。',
    next: '你说「可以」，就进「已完成」。',
    subs: [
      { key: '打包', label: '打包交付', desc: '把地址和代码包整理好。' },
      { key: '等试用', label: '等你试用', desc: '你试，有问题直接微信说。' },
    ],
  },
  {
    key: '已完成',
    short: '这单结束，需要仓库就过户。',
    intro: '这单做完了。要仓库的话，找客服过户。',
    next: '有新需求，随时传。',
    subs: [{ key: '关单', label: '关单', desc: '这单结束，不再改。' }],
  },
]

export const TIER_KEYS = TIERS.map((tier) => tier.key)
const PROGRESS_PREFIX = '进度 v1｜'

const pad = (value) => String(value).padStart(2, '0')

function timeValue(iso) {
  const value = new Date(iso).getTime()
  return Number.isNaN(value) ? 0 : value
}

/** 客户看到的时间：月-日 时:分。 */
export function formatAt(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function isProgressLine(line) {
  return typeof line === 'string' && line.startsWith(PROGRESS_PREFIX)
}

/**
 * 一行转档评论拆成字段。
 * 只负责拆，不判断这一行是不是有效；无效行会在 buildOrderView 里丢掉。
 */
function parseLine(entry) {
  const line = typeof entry?.line === 'string' ? entry.line : ''
  const fields = {}

  for (const segment of line.split('｜').slice(1)) {
    const cut = segment.indexOf('：')
    if (cut > 0) fields[segment.slice(0, cut)] = segment.slice(cut + 1)
  }

  const subRaw = fields['细阶段'] || ''
  const subMatch = subRaw.match(/^(\S+)(?:\s+(.+))?$/)

  return {
    at: entry?.at || '',
    tier: fields['客户档'] || '',
    sub: subMatch ? subMatch[1] : '',
    progress: subMatch && subMatch[2] ? subMatch[2] : '',
    round: Number(fields['轮次']) || 1,
    stuck: fields['卡住'] === '是',
    note: fields['备注'] || '',
    raw: line,
  }
}

function firstInTier(transitions, tier, round) {
  for (const transition of transitions) {
    if (transition.tier !== tier) continue
    if (round != null && transition.round !== round) continue
    return transition
  }
  return null
}

function transitionsIn(transitions, tiers, round) {
  return transitions.filter(
    (transition) =>
      tiers.includes(transition.tier) &&
      (round == null || transition.round === round),
  )
}

function markerStates(currentIndex, tierLabel, invalid) {
  return TIERS.map((_tier, index) => {
    if (invalid && index === 0) return 'warn'
    if (index < currentIndex) return 'done'
    if (index > currentIndex) return 'pending'
    return tierLabel === '已完成' ? 'done' : 'current'
  })
}

/**
 * 列表和详情共用的订单视图。
 *
 * @param {object} order 接口返回的一单
 * @param {Array<{at: string, line: string}>} order.transitions 转档行
 */
export function buildOrderView(order) {
  const transitions = (order?.transitions || [])
    .filter((entry) => isProgressLine(entry?.line))
    .map((entry) => parseLine(entry))
    .filter(
      (entry) =>
        TIER_KEYS.includes(entry.tier) ||
        entry.tier === '校验未通过' ||
        entry.tier === '已驳回',
    )
    .sort((left, right) => timeValue(left.at) - timeValue(right.at))

  const last = transitions[transitions.length - 1]
  const invalid = last?.tier === '校验未通过'
  const justRejected = last?.tier === '已驳回'
  const tierLabel = !last
    ? '已收到'
    : invalid
      ? '已收到'
      : justRejected
        ? '开发中'
        : last.tier
  const round = !last ? 1 : justRejected ? last.round + 1 : last.round
  const currentIndex = Math.max(
    0,
    TIERS.findIndex((tier) => tier.key === tierLabel),
  )
  const states = markerStates(currentIndex, tierLabel, invalid)
  const lastAt = last?.at || ''

  // 已经走过的档取第一次到达；当前档取这一轮到达。
  const arrivals = TIERS.map((tier, index) => {
    const transition =
      index === currentIndex
        ? firstInTier(transitions, tier.key, round) ||
          firstInTier(transitions, tier.key, null)
        : firstInTier(transitions, tier.key, null)
    return transition?.at || ''
  })

  const rounds = [...new Set(transitions.map((transition) => transition.round))].sort(
    (a, b) => a - b,
  )

  const currentTier = TIERS[currentIndex]
  const currentKeys = invalid ? ['已收到', '校验未通过'] : [currentTier.key]
  const currentTransitions = transitionsIn(transitions, currentKeys, round)

  let currentSubIndex = -1
  if (tierLabel !== '已完成' && !justRejected) {
    for (let index = currentTier.subs.length - 1; index >= 0; index -= 1) {
      const key = currentTier.subs[index].key
      if (currentTransitions.some((transition) => transition.sub === key)) {
        currentSubIndex = index
        break
      }
    }
  }

  const currentSubstep = currentSubIndex >= 0 ? currentTier.subs[currentSubIndex] : null
  const currentProgress = currentSubstep
    ? currentTransitions.filter((transition) => transition.sub === currentSubstep.key).at(-1)
        ?.progress || ''
    : ''

  const view = {
    transitions,
    hasTransitions: transitions.length > 0,
    invalid,
    justRejected,
    tierLabel,
    round,
    currentIndex,
    states,
    lastAt,
    uploadAt: transitions[0]?.at || '',
    arrivals,
    rounds,
    currentTier,
    currentSubIndex,
    currentSubstep,
    currentProgress,
    feedback: order?.feedback || '',
    missing: Array.isArray(order?.missing) ? order.missing : [],
    trial: Array.isArray(order?.trial) ? order.trial : [],
    delivery: order?.delivery || '',
    deliveryUrl: order?.deliveryUrl || '',
  }
  view.lede = buildLede(view)
  return view
}

function buildLede(view) {
  if (!view.hasTransitions) {
    return '还没收到这一单的进度记录。过一会儿再打开看看。'
  }
  if (view.invalid) {
    return '文件收到了，还差一些东西。'
  }
  if (view.justRejected || (view.tierLabel === '开发中' && view.round > 1)) {
    return `现在是第 ${view.round} 轮。`
  }

  const currentSub = view.currentSubstep
  if (
    view.tierLabel === '开发中' &&
    currentSub?.key === '子票开发' &&
    view.currentProgress
  ) {
    const [done, total] = view.currentProgress.split('/')
    if (done && total) {
      return `正在做第 ${done} 块，共 ${total} 块。做完会微信告诉你。`
    }
  }

  if (view.tierLabel === '待客户验收') {
    return '地址和试用清单已经发给你。你试完说一声就行。'
  }
  if (view.tierLabel === '已完成') {
    return '这单结束了。'
  }

  return view.currentTier.intro
}

/** 列表里那一行灰色小字：现在卡在哪个小步。 */
export function listSubline(view) {
  if (!view.hasTransitions) return '还没有进度记录'
  if (view.invalid) return '等你补传'
  if (view.justRejected) return '在改上一轮的问题'
  if (view.tierLabel === '已完成') return '要仓库找客服过户'
  if (view.tierLabel === '待客户验收') return '等你试'

  const sub = view.currentSubstep
  if (!sub) return view.currentTier.intro
  if (sub.key === '子票开发' && view.currentProgress) {
    const [done, total] = view.currentProgress.split('/')
    if (done && total) return `第 ${done} 块 / 共 ${total} 块`
  }

  return {
    收包: '文件已收到',
    校验: '检查文件',
    技术闸门: '确认技术选项',
    写规格: '写清要做什么',
    拆票: '拆成几块',
    点头: '最后确认',
    开工: '开始动工',
    验证: '自动检查',
    评审: '人工检查',
    合分支: '合并改动',
    合主干: '并进正式版本',
    部署: '放到线上',
    打包: '打包交付',
    等试用: '等你试',
    关单: '关单',
  }[sub.key] || sub.label
}

/** 每一档小步骤的渲染数据。 */
export function substepRows(view, tierIndex) {
  const tier = TIERS[tierIndex]
  const isFuture = tierIndex > view.currentIndex
  const isDone = view.tierLabel === '已完成'
  const isPast = tierIndex < view.currentIndex || (isDone && tierIndex === view.currentIndex)
  const isCurrent = tierIndex === view.currentIndex && !isDone
  const isInvalidPanel = view.invalid && tierIndex === 0
  const keys = isInvalidPanel ? ['已收到', '校验未通过'] : [tier.key]

  let transitions
  if (isFuture) transitions = []
  else if (isCurrent) transitions = transitionsIn(view.transitions, keys, view.round)
  else transitions = transitionsIn(view.transitions, keys, null)

  let currentSub = -1
  if (isCurrent && !view.justRejected) {
    for (let index = tier.subs.length - 1; index >= 0; index -= 1) {
      const key = tier.subs[index].key
      if (transitions.some((transition) => transition.sub === key)) {
        currentSub = index
        break
      }
    }
  }

  return tier.subs.map((sub, index) => {
    let state
    if (isFuture) state = 'future'
    else if (isPast || isDone) state = 'done'
    else if (currentSub === -1) state = 'pending'
    else if (index < currentSub) state = 'done'
    else if (index === currentSub) state = 'current'
    else state = 'pending'

    const at = isFuture ? [] : transitions.filter((transition) => transition.sub === sub.key)
    const first = at[0]
    const last = at[at.length - 1]
    const arrival = state === 'done' || state === 'current' ? first : null
    const arrivalTime = arrival ? formatAt(arrival.at) : ''
    const lastTime = last ? formatAt(last.at) : ''

    let label = sub.label
    if (sub.key === '子票开发' && (state === 'done' || state === 'current')) {
      if (last?.progress) {
        const [done, total] = last.progress.split('/')
        label = done
          ? `做第 ${done} 块${total ? `（共 ${total} 块）` : ''}`
          : sub.label
      } else {
        label = '一块一块做'
      }
    }

    let desc = sub.desc
    if (isInvalidPanel && sub.key === '校验') {
      desc = '检查出了问题，需要你补东西。补好后重新上传。'
    }

    return {
      key: sub.key,
      label,
      desc,
      state,
      time: arrivalTime,
      updated:
        state === 'current' && arrivalTime && lastTime && arrivalTime !== lastTime
          ? lastTime
          : '',
    }
  })
}

/** 详情页当前这一档的标题、说明和标签。 */
export function stageCopy(view, tierIndex) {
  const tier = TIERS[tierIndex]
  const isFuture = tierIndex > view.currentIndex
  const isDone = view.tierLabel === '已完成'
  const isPast = tierIndex < view.currentIndex || (isDone && tierIndex === view.currentIndex)
  const isCurrent = tierIndex === view.currentIndex && !isDone
  const isInvalidPanel = view.invalid && tierIndex === 0

  if (isInvalidPanel) {
    return {
      title: '校验未通过 · 还差什么',
      tag: '要补传',
      intro: '文件收到了，但还差一些东西。补好再传一次就行。',
      next: '补好后重新上传，回到「已收到」，不用重新说需求。',
    }
  }
  if (isFuture) {
    return {
      title: `${tier.key} · 还没到`,
      tag: '未到',
      intro: '还没到这一步。到了会微信告诉你。',
      next: '',
    }
  }
  if (isPast) {
    return {
      title: `${tier.key} · 已经走完`,
      tag: '已走完',
      intro: '这一档已经走完。',
      next: '',
    }
  }
  if (isCurrent) {
    const roundSuffix = view.round > 1 ? ` · 第 ${view.round} 轮` : ''
    return {
      title: `${tier.key}${roundSuffix} · 细步骤`,
      tag: '当前',
      intro: view.justRejected
        ? '上一轮你提的问题在改，这一轮还没开工。'
        : tier.intro,
      next: view.justRejected ? '开工后会从「开工」这一步重新走。' : tier.next,
    }
  }
  return { title: tier.key, tag: '', intro: '', next: '' }
}

/** 经历：按轮次列出每一档第一次到达和驳回。 */
export function historyRounds(view) {
  return view.rounds.map((round) => {
    const events = []
    for (const tier of [...TIER_KEYS, '已驳回']) {
      const transition = firstInTier(view.transitions, tier, round)
      if (transition) events.push(transition)
    }
    return { round, events }
  })
}
