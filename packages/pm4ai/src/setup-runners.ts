/* eslint-disable no-console */
import { $ } from 'bun'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { discover } from './discover.js'
import { debug, getGhRepo } from './utils.js'

const RUNNER_VERSION = '2.334.0'
const RUNNER_LABEL = 'self-hosted-mac-arm64'
const NTFY_TOPIC = '1qh-ci'
const onlineRunnerCount = async (repo: string): Promise<number> => {
  const r = await $`gh api repos/${repo}/actions/runners --jq '[.runners[]|select(.status=="online")]|length'`
    .quiet()
    .nothrow()
  if (r.exitCode !== 0) return 0
  return Number(r.stdout.toString().trim()) || 0
}
const ensureTarball = async (base: string): Promise<string> => {
  const tarball = join(base, `actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz`)
  if (!existsSync(tarball))
    await $`curl -fsSL -o ${tarball} https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz`.nothrow()
  return tarball
}
const registerRunner = async (repo: string): Promise<void> => {
  const safe = repo.replaceAll('/', '-')
  const base = join(homedir(), `actions-runner-${safe}`)
  mkdirSync(base, { recursive: true })
  const tarball = await ensureTarball(base)
  if (!existsSync(join(base, 'config.sh'))) await $`tar xzf ${tarball} -C ${base}`.nothrow()
  const tokenResult = await $`gh api -X POST repos/${repo}/actions/runners/registration-token -q .token`.quiet().nothrow()
  const token = tokenResult.stdout.toString().trim()
  if (!token) {
    debug('no registration token for', repo)
    return
  }
  await $`./config.sh --url https://github.com/${repo} --token ${token} --name ${safe}-mac --labels ${RUNNER_LABEL} --work _work --unattended --replace`
    .cwd(base)
    .nothrow()
  await $`./svc.sh install`.cwd(base).nothrow()
  await $`./svc.sh start`.cwd(base).nothrow()
}
const setRepoVars = async (repo: string): Promise<void> => {
  await $`gh variable set RUNNER_LABEL --body ${RUNNER_LABEL} -R ${repo}`.nothrow()
  await $`gh variable set NTFY_TOPIC --body ${NTFY_TOPIC} -R ${repo}`.nothrow()
}
const setupRepo = async (repo: string): Promise<void> => {
  if ((await onlineRunnerCount(repo)) < 1) await registerRunner(repo)
  await setRepoVars(repo)
}
const setupRunners = async (excludes: readonly string[] = []): Promise<void> => {
  const { cnsync, consumers, self } = await discover(undefined, excludes)
  const projects = [self, cnsync, ...consumers]
  const repos = (await Promise.all(projects.map(async p => ({ path: p.path, repo: await getGhRepo(p.path) }))))
    .filter((p): p is { path: string; repo: string } => Boolean(p.repo))
    .map(p => p.repo)
  await Promise.all(repos.map(async repo => setupRepo(repo)))
  console.log('ok')
}
export { setupRunners }
