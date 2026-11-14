import { useI18n } from '../i18n/index.jsx'

export default function LanguageToggle() {
  const { copy, toggleLang } = useI18n()

  return (
    <button
      className="pill lang-toggle"
      type="button"
      onClick={toggleLang}
      aria-label={copy.langToggle.label}
      title={copy.langToggle.title}
    >
      <span lang={copy.code === 'zh' ? 'en' : 'zh-CN'}>
        {copy.langToggle.text}
      </span>
    </button>
  )
}
