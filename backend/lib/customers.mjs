/**
 * `customers.json` 的仓指针写入。上传服务建好或复用某个软件的仓后，
 * 只写 `repos[软件简称]` 这一个键，不碰其他字段；注册机自己的命令仍走 `customer.mjs`。
 */
import { join } from 'node:path'
import { gitSync, readJson, withFileLock, writeJsonAtomic } from './store.mjs'

function rowsOf(value) {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.customers)) return value.customers
  return []
}

export function customersFile(config) {
  return join(config.dataDir, 'customers.json')
}

export async function readCustomers(config) {
  return rowsOf(await readJson(customersFile(config), []))
}

/**
 * @returns {Promise<{row: object|null, changed: boolean, sync: object|undefined}>}
 */
export async function setCustomerRepo(config, customerId, product, repoName) {
  if (!customerId || !product || !repoName) throw new Error('客户 id、软件简称和仓名都不能为空')

  const result = await withFileLock(join(config.dataDir, '.customers.lock'), async () => {
    const rows = rowsOf(await readJson(customersFile(config), []))
    const row = rows.find((item) => item.id === customerId)
    if (!row) throw new Error(`找不到客户 ${customerId}`)

    const repos =
      row.repos && typeof row.repos === 'object' && !Array.isArray(row.repos) ? { ...row.repos } : {}
    if (repos[product] === repoName) return { row, changed: false }

    repos[product] = repoName
    row.repos = repos
    await writeJsonAtomic(customersFile(config), rows)
    return { row, changed: true }
  })

  if (!result.changed) return result

  const sync = await gitSync(config.dataDir, `set repos ${customerId} ${repoName}`, {
    enabled: config.gitSync,
    timeoutMs: config.gitTimeoutMs,
  })
  return { ...result, sync }
}
