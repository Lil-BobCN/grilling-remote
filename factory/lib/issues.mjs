/**
 * 幂等的 GitHub 小操作。同一件事重复跑不建第二份。
 */
export async function ensureLabel(gh, { owner, repo, name, color = 'ededed', description = '' }) {
  const labels = await gh.listLabels({ owner, repo })
  if (labels.some((row) => row.name === name)) return false
  await gh.createLabel({ owner, repo, name, color, description })
  return true
}

export async function ensureSubIssue(gh, { owner, repo, parent, childId }) {
  const children = await gh.listSubIssues({ owner, repo, number: parent })
  if (children.some((row) => row.id === childId)) return false
  await gh.addSubIssue({ owner, repo, number: parent, subIssueId: childId })
  return true
}

export async function ensureBlockedBy(gh, { owner, repo, issue, blockerId }) {
  const blockers = await gh.listBlockedBy({ owner, repo, number: issue })
  if (blockers.some((row) => row.id === blockerId)) return false
  await gh.addBlockedBy({ owner, repo, number: issue, issueId: blockerId })
  return true
}

export async function ensureCommentOnce(gh, { owner, repo, number, body }) {
  const comments = await gh.listComments({ owner, repo, number })
  if (comments.some((row) => String(row.body).trim() === String(body).trim())) return false
  await gh.createComment({ owner, repo, number, body })
  return true
}
