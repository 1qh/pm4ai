/* eslint-disable no-console */
import { $ } from 'bun'
import type { Issue } from './types.js'
import { audit } from './audit.js'
import { checkCi, checkConfigs, checkDrift, checkForbidden, checkGit, checkRootPkg, checkVercel } from './checks.js'
import { discover } from './discover.js'
import { formatIssues, formatSwiftBar, timeAgo } from './format.js'
const status = async (swiftbar = false) => {
  const { consumers, self } = await discover()
  const allIssues = new Map<string, Issue[]>()
  const allProjects = [self, ...consumers]
  const checks = allProjects.map(async project => {
    const issues: Issue[] = []
    const results = await Promise.all([
      checkGit(project.path),
      checkDrift(self.path, project.path),
      checkRootPkg(project.path),
      checkConfigs(project.path),
      checkForbidden(project.path),
      audit(project.path),
      checkCi(project.path),
      checkVercel(project.path)
    ])
    for (const r of results) issues.push(...r)
    allIssues.set(project.path, issues)
  })
  await Promise.all(checks)
  if (swiftbar) console.log(await formatSwiftBar(allIssues))
  else {
    for (const [path, issues] of allIssues) {
      const output = formatIssues(path, issues)
      if (output) {
        console.log(output)
        console.log()
      }
    }
    await $`open swiftbar://refreshplugin?name=pm4ai`.quiet().nothrow()
  }
}
export { status, timeAgo }
