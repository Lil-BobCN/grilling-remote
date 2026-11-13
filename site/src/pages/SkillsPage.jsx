import PageShell from '../components/PageShell.jsx'
import manifest from '../../../customer-kit/manifest.json'
import '../styles/skills.css'

const skills = manifest.skills

export default function SkillsPage() {
  return (
    <PageShell
      path="/skills"
      title="技能清单"
      lede="每个技能做什么、什么时候用。不用挑，agent 会自己判断。"
      scaffold={false}
      className="skills-page"
    >
      <p className="skills-meta">
        <span>共 {skills.length} 个</span>
        <span aria-hidden="true">·</span>
        <span>{manifest.version}</span>
        <span aria-hidden="true">·</span>
        <span>{manifest.date}</span>
      </p>

      <ol className="skills-list">
        {skills.map((skill, index) => (
          <li key={skill.name}>
            <span className="skills-index" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="skills-name">{skill.name}</span>
            <div className="skills-body">
              <p className="skills-summary">{skill.summary}</p>
              <p className="skills-when">
                <b>什么时候用：</b>
                {skill.when}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <section className="skills-next" aria-labelledby="skills-next-title">
        <div>
          <h2 id="skills-next-title">技能跟着工作区走</h2>
          <p>下载解压，用 dsh 打开，技能就在里面。第一次说什么，教程里写了。</p>
        </div>
        <div className="skills-next-actions">
          <a className="skills-next-link" href="/download">
            去下载 →
          </a>
          <a className="skills-next-link skills-next-link-quiet" href="/tutorial">
            看教程
          </a>
        </div>
      </section>
    </PageShell>
  )
}
