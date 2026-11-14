import SiteLayout from './components/SiteLayout.jsx'
import DownloadPage from './pages/DownloadPage.jsx'
import HelpPage from './pages/HelpPage.jsx'
import HomePage from './pages/HomePage.jsx'
import SkillsPage from './pages/SkillsPage.jsx'
import TutorialPage from './pages/TutorialPage.jsx'

const pages = {
  home: { Component: HomePage, current: 'home' },
  download: { Component: DownloadPage, current: 'download' },
  skills: { Component: SkillsPage, current: 'skills' },
  tutorial: { Component: TutorialPage, current: 'tutorial' },
  help: { Component: HelpPage, current: 'help' },
}

export default function App({ page }) {
  const entry = pages[page] || pages.home
  const { Component, current } = entry

  return (
    <SiteLayout help={page !== 'tutorial' && page !== 'help'} current={current}>
      <Component />
    </SiteLayout>
  )
}
