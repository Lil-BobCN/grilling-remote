/**
 * 作业表：记录每个作业的 owner、repo、parent、ticket、action、attempt、lastBeat、
 * stop 和 reason，重启后还在。调度决策只读这张表，写只经这一处。
 *
 * 表放在一个 JSON 文件里，默认 `~/.afkfactory/jobs.json`，路径可注入。
 * 读坏、写不进去都抛出带路径的错误，调用方记进 report.errors，不静默丢。
 */
import {
  mkdir as mkdirDefault,
  readFile as readFileDefault,
  rename as renameDefault,
  writeFile as writeFileDefault,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const JOBS_VERSION = 1
export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_BACKOFF_BASE_MS = 10 * 60 * 1000
export const DEFAULT_BACKOFF_MAX_MS = 60 * 60 * 1000

export function defaultJobsPath({ home = homedir() } = {}) {
  return join(home, '.afkfactory', 'jobs.json')
}

/** 作业键：`owner/repo#42:finish` 或 `owner/repo#42:51:ignite`。一张父工单的每个作业各占一行。 */
export function jobKey({ owner = '', repo = '', parent, ticket = null, action = '' } = {}) {
  const base = `${owner}/${repo}#${parent}`
  const withTicket = ticket === null || ticket === undefined ? base : `${base}:${ticket}`
  return action ? `${withTicket}:${action}` : withTicket
}

function isoOf(now) {
  const date = now instanceof Date ? now : new Date(now ?? Date.now())
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString()
}

function msOf(now) {
  const value = now instanceof Date ? now.getTime() : Number(now)
  return Number.isFinite(value) ? value : Date.now()
}

/** 退避：第 n 次失败等 base × 2^(n-1)，封顶 maxMs。 */
export function backoffMs(attempt, { baseMs = DEFAULT_BACKOFF_BASE_MS, maxMs = DEFAULT_BACKOFF_MAX_MS } = {}) {
  const n = Math.max(1, Math.floor(Number(attempt) || 1))
  return Math.min(maxMs, baseMs * 2 ** (n - 1))
}

/** 调度器配置 `jobPolicy` 的退避键（`backoffBaseMs`/`backoffMaxMs`）映射到 `backoffMs` 的参数。 */
export function policyBackoffMs(attempt, policy = {}) {
  return backoffMs(attempt, {
    baseMs: policy.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
    maxMs: policy.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS,
  })
}

/** 还要等多少毫秒才能重试；0 表示现在就能跑。 */
export function retryDelayMs(row, { now, policy = {} } = {}) {
  if (!row || !row.attempt) return 0
  if (row.stop) return 0
  const last = Date.parse(row.lastBeat || '')
  if (!Number.isFinite(last)) return 0
  const wait = policyBackoffMs(row.attempt, policy)
  return Math.max(0, last + wait - msOf(now))
}

/** 这张票这一轮有没有被停线或退避挡住。 */
export function jobBlocked(row, { now, policy = {} } = {}) {
  if (!row) return false
  if (row.stop) return true
  return retryDelayMs(row, { now, policy }) > 0
}

export function findJob(rows = [], { action, ticket = null } = {}) {
  return (
    (rows || []).find(
      (row) =>
        row?.action === action &&
        (ticket === null || ticket === undefined ? row.ticket == null : row.ticket === ticket),
    ) || null
  )
}

/** 第一条 stop 记录；有它这张父工单这一轮全部停。 */
export function blockingStop(rows = []) {
  return (rows || []).find((row) => row?.stop) || null
}

function emptyTable() {
  return {
    version: JOBS_VERSION,
    heartbeat: { roundStart: null, lastBeat: null, lastEnd: null },
    jobs: {},
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.filePath] 作业表路径，默认 `~/.afkfactory/jobs.json`
 * @param {Function} [options.readFile] 读文件替身
 * @param {Function} [options.writeFile] 写文件替身
 * @param {Function} [options.rename] 原子替换文件替身
 * @param {Function} [options.mkdir] 建目录替身
 * @param {Function} [options.now] 默认时钟，方法没传 now 时用
 */
export function createJobStore({
  filePath = defaultJobsPath(),
  readFile = readFileDefault,
  writeFile = writeFileDefault,
  rename = renameDefault,
  mkdir = mkdirDefault,
  now = () => new Date(),
} = {}) {
  const table = emptyTable()
  let writing = Promise.resolve()

  function stamp(at) {
    return isoOf(at ?? now())
  }

  function putRow(key, patch) {
    table.jobs[key] = { ...(table.jobs[key] || {}), ...patch }
    return table.jobs[key]
  }

  function baseRow({ owner, repo, parent, ticket = null, action, at }) {
    const when = stamp(at)
    return { owner, repo, parent, ticket, action, lastBeat: when, updatedAt: when }
  }

  function snapshot() {
    return {
      version: JOBS_VERSION,
      heartbeat: { ...table.heartbeat },
      jobs: JSON.parse(JSON.stringify(table.jobs)),
    }
  }

  async function flush() {
    const text = `${JSON.stringify(snapshot(), null, 2)}\n`
    const temp = `${filePath}.${process.pid}.tmp`
    // 前一次写失败不能让后面的写永远跟着失败：先吞掉旧错误，再试这一次。
    writing = writing.catch(() => {}).then(async () => {
      try {
        await mkdir(dirname(filePath), { recursive: true })
        await writeFile(temp, text, 'utf8')
        await rename(temp, filePath)
      } catch (error) {
        throw new Error(`作业表写入失败（${filePath}）：${error.message}`, { cause: error })
      }
    })
    return writing
  }

  return {
    filePath,
    heartbeat: table.heartbeat,
    table,

    async load() {
      let text
      try {
        text = await readFile(filePath, 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') return { loaded: false, jobs: 0 }
        throw new Error(`作业表读取失败（${filePath}）：${error.message}`, { cause: error })
      }
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        throw new Error(`作业表读不了（${filePath}）：不是合法 JSON：${error.message}`, { cause: error })
      }
      if (!parsed || typeof parsed !== 'object' || typeof parsed.jobs !== 'object' || parsed.jobs === null) {
        throw new Error(`作业表读不了（${filePath}）：缺 jobs 对象`)
      }
      table.version = parsed.version ?? JOBS_VERSION
      table.jobs = parsed.jobs
      const beat = parsed.heartbeat || {}
      table.heartbeat.roundStart = beat.roundStart ?? null
      table.heartbeat.lastBeat = beat.lastBeat ?? null
      table.heartbeat.lastEnd = beat.lastEnd ?? null
      return { loaded: true, jobs: Object.keys(table.jobs).length }
    },

    get(key) {
      return table.jobs[key] || null
    },

    rowsFor({ owner, repo, parent } = {}) {
      return Object.values(table.jobs).filter(
        (row) => row?.owner === owner && row?.repo === repo && row?.parent === parent,
      )
    },

    all() {
      return Object.values(table.jobs)
    },

    /** 记一次失败：attempt 加一，回到退避；到上限写 stop。 */
    async recordFailure({
      owner,
      repo,
      parent,
      ticket = null,
      action,
      reason = '',
      now: at,
      policy = {},
    } = {}) {
      const key = jobKey({ owner, repo, parent, ticket, action })
      const previous = table.jobs[key]
      const attempt = (previous?.attempt || 0) + 1
      const maxAttempts = policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
      const row = putRow(key, {
        ...baseRow({ owner, repo, parent, ticket, action, at }),
        attempt,
        stop: attempt >= maxAttempts ? 'retry-exhausted' : '',
        reason: String(reason || ''),
        running: false,
      })
      await flush()
      return row
    },

    /** 记一次成功：清掉这张票这个作业的 attempt 和重试 stop。 */
    async recordSuccess({ owner, repo, parent, ticket = null, action, now: at } = {}) {
      const key = jobKey({ owner, repo, parent, ticket, action })
      const row = putRow(key, {
        ...baseRow({ owner, repo, parent, ticket, action, at }),
        attempt: 0,
        stop: '',
        reason: '',
        running: false,
      })
      await flush()
      return row
    },

    /** 管道开始：写 running 标记，屏幕和 status 能看到这张票正在跑。 */
    async markRunning({ owner, repo, parent, ticket = null, action, reason = '', now: at } = {}) {
      const key = jobKey({ owner, repo, parent, ticket, action })
      const previous = table.jobs[key] || {}
      const when = stamp(at)
      const row = putRow(key, {
        ...previous,
        owner,
        repo,
        parent,
        ticket,
        action,
        running: true,
        startedAt: previous.startedAt || when,
        lastBeat: when,
        updatedAt: when,
        ...(reason ? { reason: String(reason) } : {}),
      })
      await flush()
      return row
    },

    /** 心跳：只更新这一行的 lastBeat，不动 attempt 和 stop。 */
    async beatJob({ owner, repo, parent, ticket = null, action, now: at } = {}) {
      const key = jobKey({ owner, repo, parent, ticket, action })
      if (!table.jobs[key]) return null
      const when = stamp(at)
      const row = putRow(key, { lastBeat: when, updatedAt: when })
      await flush()
      return row
    },

    /** 管道结束：清 running，保留 attempt、stop 和 reason。 */
    async clearRunning({ owner, repo, parent, ticket = null, action, now: at } = {}) {
      const key = jobKey({ owner, repo, parent, ticket, action })
      if (!table.jobs[key]) return null
      const row = putRow(key, { running: false, lastBeat: stamp(at), updatedAt: stamp(at) })
      await flush()
      return row
    },

    /** 立即停线：needs-info、认证失败、部署失败都用它。 */
    async stop({ owner, repo, parent, ticket = null, action, stop: reasonKey, reason = '', now: at } = {}) {
      const key = jobKey({ owner, repo, parent, ticket, action })
      const previous = table.jobs[key]
      const row = putRow(key, {
        ...baseRow({ owner, repo, parent, ticket, action, at }),
        attempt: previous?.attempt || 0,
        stop: reasonKey || 'stopped',
        reason: String(reason || ''),
        running: false,
      })
      await flush()
      return row
    },

    /** 清掉这张父工单所有 stop，留着 attempt；运营者摘标签后恢复用。 */
    async clearStop({ owner, repo, parent, now: at } = {}) {
      let changed = 0
      for (const row of Object.values(table.jobs)) {
        if (row?.owner !== owner || row?.repo !== repo || row?.parent !== parent) continue
        if (!row.stop) continue
        row.stop = ''
        row.reason = ''
        row.updatedAt = stamp(at)
        changed += 1
      }
      if (changed) await flush()
      return changed
    },

    async startRound({ now: at } = {}) {
      const atIso = stamp(at)
      table.heartbeat.roundStart = atIso
      table.heartbeat.lastBeat = atIso
      await flush()
      return { ...table.heartbeat }
    },

    async beat({ now: at } = {}) {
      table.heartbeat.lastBeat = stamp(at)
      await flush()
      return table.heartbeat.lastBeat
    },

    async endRound({ now: at } = {}) {
      const atIso = stamp(at)
      table.heartbeat.roundStart = null
      table.heartbeat.lastEnd = atIso
      table.heartbeat.lastBeat = atIso
      await flush()
      return { ...table.heartbeat }
    },

    /** 一轮卡了多久；没在跑就返回 null。 */
    stalledFor(at, { stallMs = 15 * 60 * 1000 } = {}) {
      const start = Date.parse(table.heartbeat.roundStart || '')
      if (!Number.isFinite(start)) return null
      const beat = Date.parse(table.heartbeat.lastBeat || '')
      const end = msOf(at)
      const stalledMs = Math.max(end - start, Number.isFinite(beat) ? end - beat : 0)
      if (stalledMs < stallMs) return null
      return {
        roundStart: table.heartbeat.roundStart,
        lastBeat: table.heartbeat.lastBeat,
        stalledMs,
      }
    },

    flush,
  }
}
