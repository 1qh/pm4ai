/* eslint-disable no-console */
import { $ } from 'bun'
import type { Issue } from './types.js'
import { audit } from './audit.js'
import { spawnBackgroundCheck } from './check-cache.js'
import {
  checkActionRunsTests,
  checkAppTsconfigs,
  checkBannedImports,
  checkCi,
  checkCiRunner,
  checkConfigs,
  checkConvexSelfHosted,
  checkDepsLatest,
  checkDrift,
  checkForbidden,
  checkFumadocsBuild,
  checkFumadocsGithubUrl,
  checkGit,
  checkHermeticTests,
  checkLayouts,
  checkMergeMarkers,
  checkNextConfigs,
  checkPages,
  checkRelease,
  checkRootPkg,
  checkScaffoldNames,
  checkShadcnClasses,
  checkSherifScope,
  checkTailwindSourceCoverage,
  checkTypescriptPin,
  checkVercel
} from './checks.js'
import { discover, discoverSources } from './discover.js'
import { formatIssues, formatSwiftBar, timeAgo } from './format.js'
import { checkClaudeMdFresh } from './sync.js'
import { projectName, projectRootOf } from './utils.js'
import { emitToSocket } from './watch-emitter.js'
import { createEvent } from './watch-types.js'
interface StatusTarget {
  name: string
  path: string
}
const resolveStatusTargets = async (
  shouldIncludeAll: boolean,
  excludes: readonly string[]
): Promise<{ projects: StatusTarget[]; selfPath: string }> => {
  if (!shouldIncludeAll) {
    const projectPath = await projectRootOf()
    if (projectPath) {
      const { self } = await discoverSources()
      return { projects: [{ name: projectName(projectPath), path: projectPath }], selfPath: self.path }
    }
  }
  const { cnsync, consumers, self } = await discover(undefined, excludes)
  return { projects: [self, cnsync, ...consumers], selfPath: self.path }
}
const collectIssues = async (projectPath: string, selfPath: string): Promise<Issue[]> => {
  const results: Issue[][] = await Promise.all([
    checkGit(projectPath),
    checkDrift(selfPath, projectPath),
    checkClaudeMdFresh(selfPath, projectPath),
    checkRootPkg(projectPath),
    checkConfigs(projectPath),
    checkForbidden(projectPath),
    checkLayouts(projectPath),
    checkPages(projectPath),
    checkShadcnClasses(projectPath),
    checkTailwindSourceCoverage(projectPath),
    checkDepsLatest(projectPath),
    checkTypescriptPin(projectPath),
    checkSherifScope(projectPath),
    checkActionRunsTests(projectPath),
    checkNextConfigs(projectPath),
    checkAppTsconfigs(projectPath),
    checkBannedImports(projectPath),
    checkHermeticTests(projectPath),
    checkFumadocsBuild(projectPath),
    checkFumadocsGithubUrl(projectPath),
    checkMergeMarkers(projectPath),
    checkConvexSelfHosted(projectPath),
    checkScaffoldNames(projectPath),
    audit(projectPath)
  ])
  return [
    ...results.flat(),
    ...(await checkCi(projectPath)),
    ...(await checkCiRunner(projectPath)),
    ...(await checkRelease(projectPath)),
    ...(await checkVercel(projectPath))
  ]
}
const emitCheckResult = async (name: string, issues: Issue[]) => {
  const hasFails = issues.length > 0
  await emitToSocket(
    createEvent({
      detail: hasFails ? `${issues.length} issues` : undefined,
      project: name,
      status: hasFails ? 'fail' : 'ok',
      step: 'check'
    })
  )
  await emitToSocket(
    createEvent({
      detail: hasFails ? `${issues.length} issues` : 'clean',
      project: name,
      status: hasFails ? 'fail' : 'ok',
      step: 'done'
    })
  )
}
const printIssues = async (allIssues: Map<string, Issue[]>) => {
  for (const [path, issues] of allIssues) {
    console.log(formatIssues(path, issues))
    console.log()
  }
  // biome-ignore lint/style/noProcessEnv: this refresh seam is scoped to the macOS side effect
  if (process.platform === 'darwin' && process.env.PM4AI_NO_SWIFTBAR_REFRESH !== '1')
    await $`open swiftbar://refreshplugin?name=pm4ai`.quiet().nothrow()
}
const status = async (shouldUseSwiftbar = false, shouldIncludeAll = false, excludes: readonly string[] = []) => {
  const { projects, selfPath } = await resolveStatusTargets(shouldIncludeAll, excludes)
  const allIssues = new Map<string, Issue[]>()
  await Promise.all(
    projects.map(async project => {
      const name = projectName(project.path)
      await emitToSocket(createEvent({ project: name, status: 'start', step: 'check' }))
      const issues = await collectIssues(project.path, selfPath)
      allIssues.set(project.path, issues)
      await emitCheckResult(name, issues)
    })
  )
  await Promise.all(projects.map(async project => spawnBackgroundCheck(project.path)))
  if (shouldUseSwiftbar) console.log(await formatSwiftBar(allIssues))
  else await printIssues(allIssues)
}
export { status, timeAgo }
