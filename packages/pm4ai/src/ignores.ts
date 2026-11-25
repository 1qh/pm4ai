/* eslint-disable no-console, no-await-in-loop */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential project scan */
import { $ } from 'bun'
import { discover } from './discover.js'
import { projectName, projectRootOf } from './utils.js'
interface IgnoreTarget {
  name: string
  path: string
}
const discoverAll = async (): Promise<IgnoreTarget[]> => {
  const { consumers, self, cnsync } = await discover()
  return [self, cnsync, ...consumers]
}
const resolveTargets = async (shouldIncludeAll: boolean): Promise<IgnoreTarget[]> => {
  if (shouldIncludeAll) return discoverAll()
  const projectPath = await projectRootOf()
  if (projectPath) return [{ name: projectName(projectPath), path: projectPath }]
  return discoverAll()
}
const ignores = async (shouldIncludeAll = false) => {
  const projects = await resolveTargets(shouldIncludeAll)
  for (const project of projects) {
    console.log(`${project.name}:`)
    await $`bunx lintmax@latest ignores`.cwd(project.path).nothrow()
    console.log()
  }
}
export { ignores }
