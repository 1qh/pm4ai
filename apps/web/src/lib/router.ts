/* eslint-disable no-await-in-loop, @typescript-eslint/no-loop-func, @typescript-eslint/require-await */
/* oxlint-disable eslint-plugin-promise(param-names) */
/** biome-ignore-all lint/performance/noAwaitInLoops: streaming by design */
/** biome-ignore-all lint/nursery/noShadow: intentional */
/** biome-ignore-all lint/nursery/noUnnecessaryConditions: queue check */
/** biome-ignore-all lint/suspicious/useAwait: async generator */
import type { WatchEvent } from 'pm4ai'
import { os } from '@orpc/server'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkResultSchema, safeParseJson } from 'pm4ai/schemas'
import { z } from 'zod/v4'
import { validateSession } from './auth'
import { isConnected, subscribe } from './socket'
type CheckResult = z.infer<typeof checkResultSchema>
const checksDir = join(homedir(), '.pm4ai', 'checks')
const leadingSepRe = /^--/u
const readCheckResult = (projectPath: string): CheckResult | null => {
  const safeName = projectPath.replaceAll('/', '--').replace(leadingSepRe, '')
  const p = join(checksDir, `${safeName}.json`)
  if (!existsSync(p)) return null
  return safeParseJson(checkResultSchema, readFileSync(p, 'utf8')) ?? null
}
const getProjectsFromCache = (): { checkResult: CheckResult | null; name: string; path: string }[] => {
  if (!existsSync(checksDir)) return []
  return readdirSync(checksDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const safeName = f.replace('.json', '')
      const path = `/${safeName.replaceAll('--', '/')}`
      const name = path.split('/').pop() ?? ''
      const result = readCheckResult(path)
      return { checkResult: result, name, path }
    })
    .filter(p => existsSync(p.path) && !p.path.startsWith('/tmp/'))
    .filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i)
}
const authed = os.middleware(async ({ context, next }) => {
  const headers = (context as Record<string, unknown>).headers as Headers
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
  try {
    while (true) {
      if (queue.length === 0)
        await new Promise<void>(r => {
          waiting = r
        })
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
    const known = getProjectsFromCache().map(p => p.name)
    if (!known.includes(input.project)) throw new Error('Unknown project')
    const { spawn } = await import('node:child_process')
    const proc = spawn('bunx', ['pm4ai', 'fix'], {
      cwd: getProjectsFromCache().find(p => p.name === input.project)?.path,
      detached: true,
      stdio: 'ignore'
    })
    proc.unref()
    return { pid: proc.pid ?? 0 }
  })
const projectStatus = os.input(z.object({ project: z.string() })).handler(async ({ input }) => {
  const found = getProjectsFromCache().find(p => p.name === input.project)
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
