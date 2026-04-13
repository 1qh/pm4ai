/* eslint-disable no-console */
import { $ } from 'bun'
import type { Issue } from './types.js'
import { audit } from './audit.js'
import { spawnBackgroundCheck } from './check-cache.js'
import {
  checkAppTsconfigs,
  checkBannedImports,
  checkCi,
  checkConfigs,
  checkDrift,
  checkForbidden,
  checkGit,
  checkLayouts,
  checkNextConfigs,
  checkPages,
  checkRootPkg,
  checkVercel
} from './checks.js'
import { discover, discoverSources } from './discover.js'
import { formatIssues, formatSwiftBar, timeAgo } from './format.js'
import { isInsideProject, projectName } from './utils.js'
import { emitToSocket } from './watch-emitter.js'
import { createEvent } from './watch-types.js'
const status = async (swiftbar = false, all = false) => {
  let allProjects: { name: string; path: string }[]
  let selfPath: string
  if (all) {
    const { cnsync, consumers, self } = await discover()
    selfPath = self.path
    allProjects = [self, cnsync, ...consumers]
  } else {
    const projectPath = await isInsideProject()
    if (projectPath) {
      const { self } = await discoverSources()
      selfPath = self.path
      allProjects = [{ name: projectName(projectPath), path: projectPath }]
    } else {
      const { cnsync, consumers, self } = await discover()
      selfPath = self.path
      allProjects = [self, cnsync, ...consumers]
    }
  }
  const allIssues = new Map<string, Issue[]>()
  const checks = allProjects.map(async project => {
    const name = projectName(project.path)
    emitToSocket(createEvent({ project: name, status: 'start', step: 'check' }))
    const issues: Issue[] = []
    const results: Issue[][] = await Promise.all([
      checkGit(project.path),
      checkDrift(selfPath, project.path),
      checkRootPkg(project.path),
      checkConfigs(project.path),
      checkForbidden(project.path),
      checkLayouts(project.path),
      checkPages(project.path),
      checkNextConfigs(project.path),
      checkAppTsconfigs(project.path),
      checkBannedImports(project.path),
      audit(project.path)
    ])
    for (const r of results) issues.push(...r)
    issues.push(...(await checkCi(project.path)))
    issues.push(...(await checkVercel(project.path)))
    allIssues.set(project.path, issues)
    const hasFails = issues.length > 0
    emitToSocket(
      createEvent({
        detail: hasFails ? `${issues.length} issues` : undefined,
        project: name,
        status: hasFails ? 'fail' : 'ok',
        step: 'check'
      })
    )
    emitToSocket(
      createEvent({
        detail: hasFails ? `${issues.length} issues` : 'clean',
        project: name,
        status: hasFails ? 'fail' : 'ok',
        step: 'done'
      })
    )
  })
  await Promise.all(checks)
  for (const project of allProjects) spawnBackgroundCheck(project.path)
  if (swiftbar) console.log(await formatSwiftBar(allIssues))
  else {
    for (const [path, issues] of allIssues) {
      console.log(formatIssues(path, issues))
      console.log()
    }
    if (process.platform === 'darwin') await $`open swiftbar://refreshplugin?name=pm4ai`.quiet().nothrow()
  }
}
export { status, timeAgo }
