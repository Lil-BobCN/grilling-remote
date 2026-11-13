import PageShell from '../components/PageShell.jsx'

export default function HomePage() {
  return (
    <PageShell
      path="/"
      title={
        <>
          <b>把需求说清楚。</b>剩下的交给我们。
        </>
      }
      lede="下载一份客户工作区，按三步装好，跟 agent 说一句话就开始。做完把整个文件夹传回来。"
    />
  )
}
