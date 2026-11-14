/**
 * 订单进度：把转档评论行还原成客户看到的五档和小步骤。
 * 行格式见 prototype/issue-109/README.md 的「转档状态：结论」。
 *
 * 页面只认 `进度 v1｜…` 开头的行；其它评论不算转档。
 *
 * 档位和细阶段用中文键名解析（服务端协议），显示文字按语言从 content 里取。
 */
import { en } from './content/en.js'
import { zh } from './content/zh.js'

export const TIERS = [
  {
    key: '已收到',
    subs: [{ key: '收包' }, { key: '校验' }],
  },
  {
    key: '安排中',
    subs: [
      { key: '建单' },
      { key: '技术闸门' },
      { key: '写规格' },
      { key: '拆票' },
      { key: '点头' },
    ],
  },
  {
    key: '开发中',
    subs: [
      { key: '开工' },
      { key: '子票开发' },
      { key: '验证' },
      { key: '评审' },
      { key: '合分支' },
      { key: '合主干' },
      { key: '部署' },
    ],
  },
  {
    key: '待客户验收',
    subs: [{ key: '打包' }, { key: '等试用' }],
  },
  {
    key: '已完成',
    subs: [{ key: '关单' }],
  },
]

export const TIER_KEYS = TIERS.map((tier) => tier.key)
const PROGRESS_COPY = { zh: zh.progress, en: en.progress }
const PROGRESS_PREFIX = '进度 v1｜'

export function tierName(lang, key) {
  const copy = PROGRESS_COPY[lang] || PROGRESS_COPY.zh
  return copy.tiers[key]?.name || copy.branches[key] || key
}

function tierCopy(lang, key) {
  const copy = PROGRESS_COPY[lang] || PROGRESS_COPY.zh
  return copy.tiers[key]
}

function subCopy(lang, tierKey, subKey) {
  return tierCopy(lang, tierKey)?.subs?.[subKey] || { label: subKey, desc: '' }
}

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
 * @param {'zh'|'en'} lang 显示语言
 */
export function buildOrderView(order, lang = 'zh') {
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

  const currentSubstepKey =
    currentSubIndex >= 0 ? currentTier.subs[currentSubIndex].key : ''
  const currentProgress = currentSubstepKey
    ? currentTransitions.filter((transition) => transition.sub === currentSubstepKey).at(-1)
        ?.progress || ''
    : ''

  const view = {
    transitions,
    hasTransitions: transitions.length > 0,
    invalid,
    justRejected,
    tierLabel,
    tierName: tierName(lang, tierLabel),
    round,
    currentIndex,
    states,
    lastAt,
    uploadAt: transitions[0]?.at || '',
    arrivals,
    rounds,
    currentTier,
    currentSubIndex,
    currentSubstep: currentSubstepKey
      ? subCopy(lang, currentTier.key, currentSubstepKey)
      : null,
    currentSubstepKey,
    currentProgress,
    feedback: order?.feedback || '',
    missing: Array.isArray(order?.missing) ? order.missing : [],
    trial: Array.isArray(order?.trial) ? order.trial : [],
    delivery: order?.delivery || '',
    deliveryUrl: order?.deliveryUrl || '',
  }
  view.lede = buildLede(view, lang)
  return view
}

function buildLede(view, lang) {
  const copy = (PROGRESS_COPY[lang] || PROGRESS_COPY.zh).lede
  if (!view.hasTransitions) return copy.noProgress
  if (view.invalid) return copy.invalid
  if (view.justRejected || (view.tierLabel === '开发中' && view.round > 1)) {
    return copy.round(view.round)
  }

  if (
    view.tierLabel === '开发中' &&
    view.currentSubstepKey === '子票开发' &&
    view.currentProgress
  ) {
    const [done, total] = view.currentProgress.split('/')
    if (done && total) return copy.doing(done, total)
  }

  if (view.tierLabel === '待客户验收') return copy.trial
  if (view.tierLabel === '已完成') return copy.done

  return tierCopy(lang, view.tierLabel)?.intro || ''
}

/** 列表里那一行灰色小字：现在卡在哪个小步。 */
export function listSubline(view, lang) {
  const copy = (PROGRESS_COPY[lang] || PROGRESS_COPY.zh).subline
  if (!view.hasTransitions) return copy.none
  if (view.invalid) return copy.invalid
  if (view.justRejected) return copy.rejected
  if (view.tierLabel === '已完成') return copy.done
  if (view.tierLabel === '待客户验收') return copy.trial

  if (!view.currentSubstepKey) {
    return tierCopy(lang, view.tierLabel)?.intro || ''
  }
  if (view.currentSubstepKey === '子票开发' && view.currentProgress) {
    const [done, total] = view.currentProgress.split('/')
    if (done && total) return copy.pieces(done, total)
  }

  return copy.subs[view.currentSubstepKey] || view.currentSubstep?.label || ''
}

/** 每一档小步骤的渲染数据。 */
export function substepRows(view, tierIndex, lang) {
  const tier = TIERS[tierIndex]
  const copy = PROGRESS_COPY[lang] || PROGRESS_COPY.zh
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
    const display = subCopy(lang, tier.key, sub.key)
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

    let label = display.label
    if (sub.key === '子票开发' && (state === 'done' || state === 'current')) {
      if (last?.progress) {
        const [done, total] = last.progress.split('/')
        label = done
          ? copy.substep.pieceLabel(done, total)
          : display.label
      } else {
        label = copy.substep.pieceLabelFallback
      }
    }

    let desc = display.desc
    if (isInvalidPanel && sub.key === '校验') {
      desc = copy.substep.invalidCheck
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
export function stageCopy(view, tierIndex, lang) {
  const copy = PROGRESS_COPY[lang] || PROGRESS_COPY.zh
  const tier = TIERS[tierIndex]
  const name = tierName(lang, tier.key)
  const isFuture = tierIndex > view.currentIndex
  const isDone = view.tierLabel === '已完成'
  const isPast = tierIndex < view.currentIndex || (isDone && tierIndex === view.currentIndex)
  const isCurrent = tierIndex === view.currentIndex && !isDone
  const isInvalidPanel = view.invalid && tierIndex === 0

  if (isInvalidPanel) {
    return {
      title: copy.stage.invalidTitle,
      tag: copy.stage.invalidTag,
      intro: copy.stage.invalidIntro,
      next: copy.stage.invalidNext,
    }
  }
  if (isFuture) {
    return {
      title: copy.stage.futureTitle(name),
      tag: copy.stage.futureTag,
      intro: copy.stage.futureIntro,
      next: '',
    }
  }
  if (isPast) {
    return {
      title: copy.stage.pastTitle(name),
      tag: copy.stage.pastTag,
      intro: copy.stage.pastIntro,
      next: '',
    }
  }
  if (isCurrent) {
    return {
      title: copy.stage.currentTitle(name, view.round),
      tag: copy.stage.currentTag,
      intro: view.justRejected
        ? copy.stage.rejectedIntro
        : tierCopy(lang, tier.key)?.intro || '',
      next: view.justRejected
        ? copy.stage.rejectedNext
        : tierCopy(lang, tier.key)?.next || '',
    }
  }
  return { title: name, tag: '', intro: '', next: '' }
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
