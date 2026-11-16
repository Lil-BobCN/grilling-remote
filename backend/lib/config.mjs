import { resolve } from 'node:path'

function readInt(value, fallback) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function loadConfig(env = process.env) {
  const dev = env.AFK_DEV === '1' || env.NODE_ENV === 'development'
  const origins = (env.ALLOWED_ORIGINS || 'https://afkfactory.space,https://afkfactory.dev')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (dev && !env.ALLOWED_ORIGINS) {
    origins.push('http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173')
  }

  return {
    dev,
    port: readInt(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    dataDir: resolve(env.DATA_DIR || '/data/customers'),
    uploadDir: resolve(env.UPLOAD_DIR || '/data/uploads'),
    sessionSecret: env.SESSION_SECRET || '',
    cookieSecure: env.COOKIE_SECURE !== 'false' && !dev,
    allowedOrigins: origins,
    maxUploadBytes: readInt(env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024),
    maxEntries: readInt(env.ZIP_MAX_ENTRIES, 20000),
    maxUncompressed: readInt(env.ZIP_MAX_UNCOMPRESSED, 512 * 1024 * 1024),
    maxFileBytes: readInt(env.ZIP_MAX_FILE, 128 * 1024 * 1024),
    retentionMs: readInt(env.UPLOAD_RETENTION_DAYS, 7) * 86400000,
    uploadsPerUser: readInt(env.UPLOADS_PER_USER, 5),
    uploadsPerIp: readInt(env.UPLOADS_PER_IP, 20),
    loginsPerIp: readInt(env.LOGINS_PER_IP, 20),
    rateWindowMs: readInt(env.RATE_WINDOW_MS, 10 * 60 * 1000),
    python: env.PYTHON || 'python3',
    gitSync: env.AFK_GIT_SYNC !== '0',
    gitTimeoutMs: readInt(env.AFK_GIT_TIMEOUT_MS, 15000),
    syncRetryMs: readInt(env.AFK_SYNC_RETRY_MS, 60 * 1000),
    githubToken: env.GITHUB_TOKEN || '',
    githubApi: env.GITHUB_API || 'https://api.github.com',
    githubTimeoutMs: readInt(env.GITHUB_TIMEOUT_MS, 5000),
    progressCacheMs: readInt(env.PROGRESS_CACHE_MS, 60 * 1000),
  }
}
