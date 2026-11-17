// 测试库冒烟：用 pglite 起一个内存 Postgres，建表、写入、读回。
// 客户仓的数据库测试都走 pglite，不连外部 Postgres 服务。
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
try {
  await db.exec('create table smoke (id integer primary key, name text not null)')
  await db.query('insert into smoke (id, name) values ($1, $2)', [1, 'ok'])
  const { rows } = await db.query('SELECT name FROM smoke WHERE id = 1')
  if (rows[0]?.name !== 'ok') {
    console.error('pglite 冒烟失败：写入后读不回')
    process.exitCode = 1
  } else {
    console.log('pglite 冒烟通过：建表、写入、读回')
  }
} finally {
  await db.close()
}
