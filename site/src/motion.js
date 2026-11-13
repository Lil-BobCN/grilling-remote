const REVEAL_MARGIN = '0px 0px -8% 0px'

/**
 * 页面加载后接上动效。
 * 滚动出现用 IntersectionObserver；离开视口的循环暂停。
 * 浏览器不支持时直接把内容放出来，不留空白。
 */
export function initMotion() {
  window.__afkMotionReady = true

  if (window.__afkMotionStarted) return
  window.__afkMotionStarted = true

  initLoops()

  const reveals = [...document.querySelectorAll('[data-reveal]')]
  if (!reveals.length) return

  if (!('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-revealed'))
    return
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-revealed')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: REVEAL_MARGIN, threshold: 0 },
  )

  reveals.forEach((el) => observer.observe(el))
}

function initLoops() {
  const loops = [...document.querySelectorAll('[data-motion-loop]')]
  if (!loops.length) return

  if (!('IntersectionObserver' in window)) return

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('is-paused', !entry.isIntersecting)
      }
    },
    { threshold: 0 },
  )

  loops.forEach((el) => observer.observe(el))
}
