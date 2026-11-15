export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit
    this.windowMs = windowMs
    this.hits = new Map()
  }

  allow(key, now = Date.now()) {
    const recent = (this.hits.get(key) || []).filter((at) => now - at < this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }

  sweep(now = Date.now()) {
    for (const [key, times] of this.hits) {
      const kept = times.filter((at) => now - at < this.windowMs)
      if (kept.length) this.hits.set(key, kept)
      else this.hits.delete(key)
    }
  }
}
