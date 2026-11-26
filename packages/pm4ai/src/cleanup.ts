/** biome-ignore-all lint/performance/noAwaitInLoops: npm mutations must remain sequential to avoid manifest-write conflicts */
/* eslint-disable no-console -- cleanup diagnostics are CLI output */
import { env, file, sleep, spawn } from 'bun'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
interface CommandResult {
  exitCode: number
  stderr: string
}
const runCommand = async (cmd: string[]): Promise<CommandResult> => {
  const timeout = 120_000
  try {
    const subprocess = spawn({ cmd, stderr: 'pipe', stdout: 'ignore', timeout })
    const [exitCode, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stderr).text()])
    const signal = subprocess.signalCode
    const diagnostic = signal ? `\n${cmd.join(' ')} terminated by ${signal} (timeout ${timeout}ms)` : ''
    return { exitCode: signal ? 1 : exitCode, stderr: `${stderr}${diagnostic}` }
  } catch (error) {
    return { exitCode: 1, stderr: String(error) }
  }
}
const registryVersions = (document: unknown): object => {
  if (typeof document !== 'object' || document === null || !('versions' in document))
    throw new Error('registry document missing versions')
  const { versions } = document
  if (typeof versions !== 'object' || versions === null || Array.isArray(versions))
    throw new Error('registry document versions must be an object')
  return versions
}
const versionsToRetire = (document: unknown, current: string): string[] => {
  const entries: [string, unknown][] = Object.entries(registryVersions(document))
  const selected: string[] = []
  for (const [version, metadata] of entries) {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
      throw new Error(`registry document has invalid metadata for ${version}`)
    if (version !== current && !('deprecated' in metadata)) selected.push(version)
  }
  return selected
}
const isRetired = (document: unknown, version: string): boolean => {
  const metadata: unknown = Object.entries(registryVersions(document)).find(([v]) => v === version)?.[1]
  return metadata === undefined || (typeof metadata === 'object' && metadata !== null && 'deprecated' in metadata)
}
const REGISTRY_WAIT_MS = 600_000
const REGISTRY_POLL_MS = 15_000
const RETIRE_WAIT_MS = 180_000
const fetchDocument = async (name: string): Promise<unknown> => {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`registry request failed: ${response.status} ${response.statusText}`)
  const document: unknown = await response.json()
  return document
}
const documentWithVersion = async (name: string, version: string, deadline: number): Promise<unknown> => {
  const document = await fetchDocument(name)
  if (Object.hasOwn(registryVersions(document), version)) return document
  if (Date.now() >= deadline)
    throw new Error(
      `current version ${version} is still absent from the registry after 10 minutes; refusing to retire versions`
    )
  await sleep(Math.min(REGISTRY_POLL_MS, deadline - Date.now()))
  const next = await documentWithVersion(name, version, deadline)
  return next
}
const pendingAfter = async (name: string, versions: string[], deadline: number): Promise<string[]> => {
  const document = await fetchDocument(name)
  const pending = versions.filter(v => !isRetired(document, v))
  if (pending.length === 0 || Date.now() >= deadline) return pending
  await sleep(Math.min(REGISTRY_POLL_MS, deadline - Date.now()))
  const next = await pendingAfter(name, versions, deadline)
  return next
}
const retireOne = async (spec: string, userconfig: string): Promise<string> => {
  const unpublish = await runCommand(['npm', 'unpublish', spec, '--userconfig', userconfig])
  const deprecate = await runCommand(['npm', 'deprecate', spec, 'superseded by latest', '--userconfig', userconfig])
  return `${spec}: unpublish exit ${unpublish.exitCode} ${unpublish.stderr.trim()} | deprecate exit ${deprecate.exitCode} ${deprecate.stderr.trim()}`
}
const confirmRetirement = async (name: string, versions: string[], attempts: string[]): Promise<number> => {
  try {
    const pending = await pendingAfter(name, versions, Date.now() + RETIRE_WAIT_MS)
    const stillPending = new Set(pending)
    const retired = versions.filter(v => !stillPending.has(v))
    for (const version of retired) console.log(`${name}@${version} retired`)
    if (pending.length === 0) return 0
    console.error(`${name}: still published and not deprecated after 3 minutes: ${pending.join(', ')}`)
  } catch (error) {
    console.error(`${name}: could not confirm retirement of ${versions.join(', ')}: ${String(error)}`)
  }
  for (const attempt of attempts) console.error(attempt)
  return 1
}
const retireVersions = async (name: string, versions: string[], userconfig: string): Promise<number> => {
  const attempts: string[] = []
  // eslint-disable-next-line no-await-in-loop -- sequential npm mutations avoid manifest-write conflicts
  for (const version of versions) attempts.push(await retireOne(`${name}@${version}`, userconfig))
  const code = await confirmRetirement(name, versions, attempts)
  return code
}
const withUserconfig = async (token: string, run: (userconfig: string) => Promise<number>): Promise<number> => {
  const dir = await mkdtemp(join(tmpdir(), 'pm4ai-npmrc-'))
  const userconfig = join(dir, 'npmrc')
  try {
    await writeFile(userconfig, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 })
    const code = await run(userconfig)
    return code
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}
const readPackage = async (): Promise<{ name: string; version: string }> => {
  const pkg: unknown = await file(join(process.cwd(), 'package.json')).json()
  if (typeof pkg !== 'object' || pkg === null || !('name' in pkg && 'version' in pkg))
    throw new Error('package.json missing name or version')
  if (typeof pkg.name !== 'string' || pkg.name.length === 0 || typeof pkg.version !== 'string' || pkg.version.length === 0)
    throw new Error('package.json name and version must be non-empty strings')
  return { name: pkg.name, version: pkg.version }
}
const readToken = (): string => {
  const token = env.NPM_CONFIG_TOKEN
  if (token === undefined || token === '') throw new Error('NPM_CONFIG_TOKEN is not set, so npm cannot retire versions')
  return token
}
const retireOldVersions = async ({ name, token, version }: { name: string; token: string; version: string }) => {
  const document = await documentWithVersion(name, version, Date.now() + REGISTRY_WAIT_MS)
  const selected = versionsToRetire(document, version)
  if (selected.length === 0) {
    console.log(`${name}: no versions to retire`)
    return 0
  }
  const code = await withUserconfig(token, async userconfig => retireVersions(name, selected, userconfig))
  return code
}
const cleanup = async () => {
  try {
    const { name, version } = await readPackage()
    const token = readToken()
    process.exitCode = await retireOldVersions({ name, token, version })
  } catch (error) {
    console.error(`cleanup failed: ${String(error)}`)
    process.exitCode = 1
  }
}
export { cleanup, isRetired, versionsToRetire }
