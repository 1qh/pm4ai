/* eslint-disable no-console, no-await-in-loop */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential project scan */
import { $ } from 'bun'
import { discover } from './discover.js'
import { isInsideProject, projectName } from './utils.js'
const ignores = async (all = false) => {
  let projects: { name: string; path: string }[]
  if (all) {
    const { consumers, self, cnsync } = await discover()
    projects = [self, cnsync, ...consumers]
  } else {
    const projectPath = await isInsideProject()
    if (projectPath) projects = [{ name: projectName(projectPath), path: projectPath }]
    else {
      const { consumers, self, cnsync } = await discover()
      projects = [self, cnsync, ...consumers]
    }
  }
  for (const project of projects) {
    console.log(`${project.name}:`)
    await $`bunx lintmax@latest ignores`.cwd(project.path).nothrow()
    console.log()
  }
}
export { ignores }
