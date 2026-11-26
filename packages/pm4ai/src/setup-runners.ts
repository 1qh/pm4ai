/* eslint-disable no-console */
import { file, spawn } from 'bun'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { discover } from './discover.js'
import { getGhRepo } from './utils.js'
const RUNNER_VERSION = '2.334.0'
const RUNNER_LABEL = 'self-hosted-mac-arm64'
const NTFY_TOPIC = '1qh-ci'
const runRunnerCommand = async (command: string[], cwd?: string): Promise<string> => {
  const proc = spawn(command, { cwd, stderr: 'inherit', stdout: 'pipe', timeout: 120_000 })
  const [output, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (exitCode === 0) return output.trim()
  throw new Error(`Runner command failed: ${command[0]} (exit ${exitCode})`)
}
const nextRunnerName = (registeredNames: readonly string[]): string => {
  const names = new Set(registeredNames)
  let number = 1
  while (names.has(String(number))) number += 1
  return String(number)
}
const runnerBase = (repo: string, name: string, home: string): string => {
  const directory = repo.split('/').pop() ?? repo.replaceAll('/', '-')
  return join(home, '.actions-runners', directory, name)
}
const onlineRunnerCount = async (repo: string): Promise<number> => {
  const output = await runRunnerCommand([
    'gh',
    'api',
    '--paginate',
    `repos/${repo}/actions/runners`,
    '--jq',
    '.runners[] | select(.status == "online") | .id'
  ])
  return output.length === 0 ? 0 : output.split('\n').length
}
const ensureTarball = async (base: string): Promise<string> => {
  const tarball = join(base, `actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz`)
  const hasTarball = await file(tarball).exists()
  if (!hasTarball)
    await runRunnerCommand([
      'curl',
      '-fsSL',
      '-o',
      tarball,
      `https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz`
    ])
  return tarball
}
const extractRunner = async (base: string, tarball: string) => {
  const hasConfig = await file(join(base, 'config.sh')).exists()
  if (!hasConfig) await runRunnerCommand(['tar', 'xzf', tarball, '-C', base])
}
const fetchRegistrationToken = async (repo: string): Promise<string> => {
  const token = await runRunnerCommand([
    'gh',
    'api',
    '-X',
    'POST',
    `repos/${repo}/actions/runners/registration-token`,
    '-q',
    '.token'
  ])
  if (token.length === 0) throw new Error(`No registration token for ${repo}`)
  return token
}
const startRunner = async ({ base, name, repo, token }: { base: string; name: string; repo: string; token: string }) => {
  await runRunnerCommand(
    [
      './config.sh',
      '--url',
      `https://github.com/${repo}`,
      '--token',
      token,
      '--name',
      name,
      '--labels',
      RUNNER_LABEL,
      '--work',
      '_work',
      '--unattended'
    ],
    base
  )
  await runRunnerCommand(['./svc.sh', 'install'], base)
  await runRunnerCommand(['./svc.sh', 'start'], base)
}
const registerRunner = async (repo: string) => {
  const output = await runRunnerCommand([
    'gh',
    'api',
    '--paginate',
    `repos/${repo}/actions/runners`,
    '--jq',
    '.runners[].name'
  ])
  const name = nextRunnerName(output.split('\n'))
  const base = runnerBase(repo, name, homedir())
  await mkdir(base, { recursive: true })
  const tarball = await ensureTarball(base)
  await extractRunner(base, tarball)
  const token = await fetchRegistrationToken(repo)
  await startRunner({ base, name, repo, token })
}
const setRepoVars = async (repo: string) => {
  await runRunnerCommand(['gh', 'variable', 'set', 'RUNNER_LABEL', '--body', RUNNER_LABEL, '-R', repo])
  await runRunnerCommand(['gh', 'variable', 'set', 'NTFY_TOPIC', '--body', NTFY_TOPIC, '-R', repo])
}
const setupRepo = async (repo: string) => {
  if ((await onlineRunnerCount(repo)) < 1) await registerRunner(repo)
  await setRepoVars(repo)
}
const setupRunners = async (excludes: readonly string[] = []) => {
  const { cnsync, consumers, self } = await discover(undefined, excludes)
  const projects = [self, cnsync, ...consumers]
  const repos = (await Promise.all(projects.map(async p => ({ path: p.path, repo: await getGhRepo(p.path) }))))
    .filter((p): p is { path: string; repo: string } => Boolean(p.repo))
    .map(p => p.repo)
  await Promise.all([...new Set(repos)].map(async repo => setupRepo(repo)))
  console.log('ok')
}
export { nextRunnerName, runnerBase, setupRunners }
