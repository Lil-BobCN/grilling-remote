import PageShell from '../components/PageShell.jsx'
import { skillText, useI18n } from '../i18n/index.jsx'
import manifest from '../../../customer-kit/manifest.json'
import '../styles/skills.css'

const skills = manifest.skills

export default function SkillsPage() {
  const { lang, copy } = useI18n()
  const s = copy.skills

  return (
    <PageShell
      path="/skills"
      title={s.title}
      lede={s.lede}
      scaffold={false}
      className="skills-page"
    >
      <p className="skills-meta" data-reveal="fade" style={{ '--reveal-delay': '120ms' }}>
        <span>{s.count(skills.length)}</span>
        <span aria-hidden="true">·</span>
        <span>{manifest.version}</span>
        <span aria-hidden="true">·</span>
        <span>{manifest.date}</span>
      </p>

      <ol className="skills-list">
        {skills.map((skill, index) => {
          const text = skillText(lang, skill, copy)
          return (
            <li
              key={skill.name}
              data-reveal="row"
              style={{ '--reveal-delay': `${Math.min(index * 55, 330)}ms` }}
            >
              <span className="skills-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="skills-name">{skill.name}</span>
              <div className="skills-body">
                <p className="skills-summary">{text.summary}</p>
                <p className="skills-when">
                  <b>{s.whenLabel}</b>
                  {text.when}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      <section
        className="skills-next"
        aria-labelledby="skills-next-title"
        data-reveal="panel"
      >
        <div>
          <h2 id="skills-next-title">{s.nextTitle}</h2>
          <p>{s.nextBody}</p>
        </div>
        <div className="skills-next-actions">
          <a className="skills-next-link" href="/download">
            {s.downloadLink}
          </a>
          <a className="skills-next-link skills-next-link-quiet" href="/tutorial">
            {s.guideLink}
          </a>
        </div>
      </section>
    </PageShell>
  )
}
