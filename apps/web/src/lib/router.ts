/* eslint-disable no-await-in-loop, @typescript-eslint/require-await */
/** biome-ignore-all lint/performance/noAwaitInLoops: streaming by design */
/** biome-ignore-all lint/suspicious/noUnnecessaryConditions: infinite async generator queue check */
/** biome-ignore-all lint/suspicious/useAwait: async generator */
import type { WatchEvent } from 'pm4ai'
import { os } from '@orpc/server'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkResultSchema, safeParseJson } from 'pm4ai/schemas'
import { z } from 'zod/v4'
import { validateSession } from './auth'
import { isConnected, subscribe } from './socket'

type CheckResult = z.infer<typeof checkResultSchema>
const checksDir = join(homedir(), '.pm4ai', 'checks')
const leadingSepRe = /^--/u
interface AuthedContext {
  headers: Headers
}
const pathExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
const readCheckResult = async (projectPath: string): Promise<CheckResult | null> => {
  const safeName = projectPath.replaceAll('/', '--').replace(leadingSepRe, '')
  const p = join(checksDir, `${safeName}.json`)
  if (!(await pathExists(p))) return null
  return safeParseJson(checkResultSchema, await readFile(p, 'utf8')) ?? null
}
const getProjectsFromCache = async (): Promise<{ checkResult: CheckResult | null; name: string; path: string }[]> => {
  const dirExists = await pathExists(checksDir)
  if (!dirExists) return []
  const entries = await readdir(checksDir)
  const mapped = await Promise.all(
    entries
      .filter(f => f.endsWith('.json'))
      .map(async f => {
        const safeName = f.replace('.json', '')
        const path = `/${safeName.replaceAll('--', '/')}`
        const name = path.split('/').pop() ?? ''
        const result = await readCheckResult(path)
        const projExists = await pathExists(path)
        return { checkResult: result, keep: projExists && !path.startsWith(`${tmpdir()}/`), name, path }
      })
  )
  return mapped
    .filter(p => p.keep)
    .map(({ checkResult, name, path }) => ({ checkResult, name, path }))
    .filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i)
}
const authed = os.middleware(async ({ context, next }) => {
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: oRPC middleware context exposes request headers through an untyped context */
  const { headers } = context as AuthedContext
  if (!validateSession(headers.get('cookie'))) throw new Error('Unauthorized')
  return next({})
})
const projects = os.handler(async () => getProjectsFromCache())
const events = os.handler(async function* generateEvents() {
  const queue: WatchEvent[] = []
  let waiting: (() => void) | undefined
  const unsub = subscribe(event => {
    queue.push(event)
    waiting?.()
  })
  const waitForEvent = async (): Promise<void> => {
    const pending = new Promise<void>(resolve => {
      waiting = resolve
    })
    await pending
  }
  try {
    while (true) {
      if (queue.length === 0) await waitForEvent()
      while (queue.length > 0) {
        const event = queue.shift()
        if (event) yield event
      }
    }
  } finally {
    unsub()
  }
})
const fixAll = os
  .use(authed)
  .input(z.object({ all: z.boolean().default(true) }))
  .handler(async ({ input }) => {
    const args = input.all ? ['pm4ai', 'fix', '--all'] : ['pm4ai', 'fix']
    const { spawn } = await import('node:child_process')
    const proc = spawn('bunx', args, { detached: true, stdio: 'ignore' })
    proc.unref()
    return { pid: proc.pid ?? 0 }
  })
const refreshStatus = os
  .use(authed)
  .input(z.object({ all: z.boolean().default(true) }))
  .handler(async ({ input }) => {
    const args = input.all ? ['pm4ai', 'status', '--all'] : ['pm4ai', 'status']
    const { spawn } = await import('node:child_process')
    const proc = spawn('bunx', args, { detached: true, stdio: 'ignore' })
    proc.unref()
    return { pid: proc.pid ?? 0 }
  })
const projectNameRe = /^[\w-]+$/u
const fixProject = os
  .use(authed)
  .input(z.object({ project: z.string() }))
  .handler(async ({ input }) => {
    if (!projectNameRe.test(input.project)) throw new Error('Invalid project name')
    const cached = await getProjectsFromCache()
    const known = cached.map(p => p.name)
    if (!known.includes(input.project)) throw new Error('Unknown project')
    const { spawn } = await import('node:child_process')
    const proc = spawn('bunx', ['pm4ai', 'fix'], {
      cwd: cached.find(p => p.name === input.project)?.path,
      detached: true,
      stdio: 'ignore'
    })
    proc.unref()
    return { pid: proc.pid ?? 0 }
  })
const projectStatus = os.input(z.object({ project: z.string() })).handler(async ({ input }) => {
  const found = (await getProjectsFromCache()).find(p => p.name === input.project)
  if (!found) return null
  return found
})
const socketStatus = os.handler(async () => ({ connected: isConnected() }))
const router = os.router({
  events,
  fixAll,
  fixProject,
  projectStatus,
  projects,
  refreshStatus,
  socketStatus
})
type Router = typeof router
export { router }
export type { Router }
