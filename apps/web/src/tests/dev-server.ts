import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const runDistDir = (): string => `.next/test-${String(process.pid)}`
const leadingDashes = /^--/u
const removeFixture = async (fixtureDir: string) => {
  await rm(fixtureDir, { force: true, recursive: true })
}
const createFixtureDirectories = async (projectPath: string, checksDirectory: string) => {
  const directories = [
    mkdir(join(projectPath, '.git', 'objects'), { recursive: true }),
    mkdir(join(projectPath, '.git', 'refs', 'heads'), { recursive: true }),
    mkdir(checksDirectory, { recursive: true })
  ]
  await Promise.all(directories)
}
const writeFixtureFiles = async (projectPath: string, checksDirectory: string) => {
  const encodedProjectPath = projectPath.replaceAll('/', '--')
  const checkName = encodedProjectPath.replace(leadingDashes, '')
  const checkPath = join(checksDirectory, `${checkName}.json`)
  const files = [
    writeFile(join(projectPath, '.git', 'HEAD'), 'ref: refs/heads/main\n'),
    writeFile(join(projectPath, '.git', 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n'),
    writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'pm4ai' })
    ),
    writeFile(join(projectPath, 'turbo.json'), '{}'),
    writeFile(checkPath, JSON.stringify({ at: '2026-01-01T00:00:00Z', pass: true, violations: 0 }))
  ]
  await Promise.all(files)
}
const createFixture = async (fixtureDir: string) => {
  const projectPath = join(fixtureDir, 'pm4ai')
  const stateDirectory = join(fixtureDir, 'state')
  const checksDirectory = join(stateDirectory, 'checks')
  await createFixtureDirectories(projectPath, checksDirectory)
  await writeFixtureFiles(projectPath, checksDirectory)
  return { projectPath, stateDirectory }
}
const startServer = (
  dashboardDir: string,
  fixture: Awaited<ReturnType<typeof createFixture>> & { fixtureDir: string },
  port: number
) => {
  const { fixtureDir, stateDirectory } = fixture
  const distDir = runDistDir()
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- e2e test invoking a trusted PATH tool
  const server: ChildProcess = spawn('bun', ['run', 'next', 'dev', '--port', String(port)], {
    cwd: dashboardDir,
    // biome-ignore lint/style/noProcessEnv: the server owns its build directory, discovery root and state directory
    env: { ...process.env, NEXT_DIST_DIR: distDir, PM4AI_HOME: fixtureDir, PM4AI_STATE_DIR: stateDirectory },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  return { distDir, server }
}
const spawnDevServer = async (dashboardDir: string, port: number) => {
  const fixturePrefix = join(dashboardDir, 'test-fixture-')
  const temporaryDirectory = await mkdtemp(fixturePrefix)
  const fixtureDir = await realpath(temporaryDirectory)
  try {
    const fixture = await createFixture(fixtureDir)
    const started = startServer(dashboardDir, { ...fixture, fixtureDir }, port)
    return { ...fixture, ...started, fixtureDir }
  } catch (error) {
    await removeFixture(fixtureDir)
    throw error
  }
}
const cleanDistDir = async (dashboardDir: string, distDir: string, fixtureDir: string) => {
  const buildDirectory = join(dashboardDir, distDir)
  await Promise.all([rm(buildDirectory, { force: true, recursive: true }), removeFixture(fixtureDir)])
}
export { cleanDistDir, spawnDevServer }
