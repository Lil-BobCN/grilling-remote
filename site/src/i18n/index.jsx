import { Fragment, useEffect, useSyncExternalStore } from 'react'
import { en } from '../content/en.js'
import { zh } from '../content/zh.js'

const STORAGE_KEY = 'afk-lang'
const COPY = { zh, en }

let current = readInitialLang()
const listeners = new Set()

function readInitialLang() {
  if (typeof document === 'undefined') return 'zh'
  const stored = document.documentElement.getAttribute('data-lang')
  return stored === 'en' ? 'en' : 'zh'
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return current
}

function getServerSnapshot() {
  return 'zh'
}

function applyToDocument(lang) {
  const root = document.documentElement
  if (lang === 'en') {
    root.lang = 'en'
    root.setAttribute('data-lang', 'en')
  } else {
    root.lang = 'zh-CN'
    root.removeAttribute('data-lang')
  }
  root.classList.remove('lang-pending')
}

export function setLang(next) {
  if (next !== 'zh' && next !== 'en') return
  if (next === current) {
    applyToDocument(next)
    return
  }
  current = next
  applyToDocument(next)
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 存不下就只在这次浏览里生效
  }
  for (const listener of listeners) listener()
}

export function getLang() {
  return current
}

export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const copy = COPY[lang]

  return {
    lang,
    copy,
    setLang,
    toggleLang: () => setLang(lang === 'zh' ? 'en' : 'zh'),
  }
}

/** 页面标题和 description 跟着语言换；静态 HTML 里的中文留给不跑脚本的浏览器。 */
export function usePageMeta(meta) {
  useEffect(() => {
    if (!meta) return
    if (meta.title) document.title = meta.title
    if (meta.description) {
      const node = document.querySelector('meta[name="description"]')
      if (node) node.setAttribute('content', meta.description)
    }
  }, [meta])
}

/** 清单里的技能说明：中文直接用 manifest，英文用文案表，缺了退回 manifest。 */
export function skillText(lang, skill, copy) {
  if (lang === 'en') {
    const translated = copy.skillDetails?.[skill.name]
    if (translated) return translated
  }
  return { summary: skill.summary, when: skill.when }
}

function renderPart(part, index) {
  if (part == null || part === false) return null
  if (typeof part === 'string' || typeof part === 'number') return part

  if (part.a) {
    const external = part.external
      ? { target: '_blank', rel: 'noreferrer' }
      : undefined
    return (
      <a href={part.a} {...external}>
        {renderParts(part.text)}
      </a>
    )
  }
  if (part.b) return <b>{renderParts(part.b)}</b>
  if (part.code) return <code>{renderParts(part.code)}</code>
  if (part.zh) return <span lang="zh-CN">{renderParts(part.zh)}</span>
  if (part.br) return <br className={part.cls} />
  if (part.span) {
    return (
      <span
        className={part.cls}
        lang={part.lang || undefined}
        aria-hidden={part.ariaHidden || undefined}
      >
        {renderParts(part.span)}
      </span>
    )
  }
  return null
}

function renderParts(parts) {
  if (parts == null) return null
  if (!Array.isArray(parts)) return renderPart(parts)
  return parts.map((part, index) => (
    <Fragment key={index}>{renderPart(part, index)}</Fragment>
  ))
}

/** 文案里的富文本：字符串原样，{a} 链接，{b} 加粗，{code} 等宽，{span} 包一层。 */
export function Rich({ parts }) {
  return <>{renderParts(parts)}</>
}
