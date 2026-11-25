import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const runDistDir = (): string => `.next/test-${String(process.pid)}`
const spawnDevServer = async (dashboardDir: string, port: number) => {
  const fixtureDir = await realpath(await mkdtemp(join(dashboardDir, 'test-fixture-')))
  try {
    const projectPath = join(fixtureDir, 'pm4ai')
    const stateDirectory = join(fixtureDir, 'state')
    const checksDirectory = join(stateDirectory, 'checks')
    await Promise.all([
      mkdir(join(projectPath, '.git', 'objects'), { recursive: true }),
      mkdir(join(projectPath, '.git', 'refs', 'heads'), { recursive: true }),
      mkdir(checksDirectory, { recursive: true })
    ])
    await Promise.all([
      writeFile(join(projectPath, '.git', 'HEAD'), 'ref: refs/heads/main\n'),
      writeFile(join(projectPath, '.git', 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n'),
      writeFile(join(projectPath, 'package.json'), JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'pm4ai' })),
      writeFile(join(projectPath, 'turbo.json'), '{}'),
      writeFile(join(checksDirectory, `${projectPath.replaceAll('/', '--').replace(/^--/u, '')}.json`),
        JSON.stringify({ at: '2026-01-01T00:00:00Z', pass: true, violations: 0 }))
    ])
    const distDir = runDistDir()
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- e2e test invoking a trusted PATH tool
    const server: ChildProcess = spawn('bun', ['run', 'next', 'dev', '--port', String(port)], {
      cwd: dashboardDir,
      // biome-ignore lint/style/noProcessEnv: the server owns its build directory, discovery root and state directory
      env: { ...process.env, NEXT_DIST_DIR: distDir, PM4AI_HOME: fixtureDir, PM4AI_STATE_DIR: stateDirectory },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { distDir, fixtureDir, projectPath, server, stateDirectory }
  } catch (error) {
    await rm(fixtureDir, { force: true, recursive: true })
    throw error
  }
}
const cleanDistDir = async (dashboardDir: string, distDir: string, fixtureDir: string) => {
  await Promise.all([
    rm(join(dashboardDir, distDir), { force: true, recursive: true }),
    rm(fixtureDir, { force: true, recursive: true })
  ])
}
export { cleanDistDir, spawnDevServer }
