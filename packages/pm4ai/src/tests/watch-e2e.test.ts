/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unnecessary-condition */
import type { ChildProcess } from 'node:child_process'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { WatchEvent } from '../watch-types.js'
import { parseJson } from '../json.js'
import { doesSocketExist, emitToSocket, stopEmitter } from '../watch-emitter.js'
import { createEvent } from '../watch-types.js'
setDefaultTimeout(60_000)
const isCI = 'CI' in process.env
const wait = async (ms: number): Promise<void> =>
  new Promise(r => {
    setTimeout(r, ms)
  })
const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs')
const waitForSocket = async (timeout = 5000): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const doesExist = await doesSocketExist()
    if (doesExist) return
    await wait(100)
  }
  throw new Error('watch.sock not created in time')
}
type EventInput = Parameters<typeof createEvent>[0]
const emitAll = async (events: EventInput[]) => {
  for (const event of events) await emitToSocket(createEvent(event))
}
const startWatchJson = (): { lines: string[]; process: ChildProcess } => {
  const lines: string[] = []
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- e2e test invoking a trusted PATH tool
  const p = spawn('bun', ['run', cliPath, 'watch', '--json'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  p.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) if (line.trim()) lines.push(line)
  })
  p.stderr?.on('data', () => {})
  return { lines, process: p }
}
const withWatchJson = async (run: (lines: string[]) => Promise<void>) => {
  const { lines, process: p } = startWatchJson()
  try {
    await waitForSocket()
    await wait(200)
    await run(lines)
  } finally {
    p.kill()
    await stopEmitter()
    await wait(200)
  }
}
const lifecycle: [string, 'audit' | 'done' | 'maintain' | 'sync', 'fail' | 'ok' | 'start', string?][] = [
  ['myapp', 'sync', 'start'],
  ['myapp', 'sync', 'ok', '3 synced'],
  ['myapp', 'audit', 'start'],
  ['myapp', 'audit', 'ok'],
  ['myapp', 'maintain', 'start'],
  ['myapp', 'maintain', 'ok', '2 fixed'],
  ['myapp', 'done', 'ok', 'clean']
]
describe.skipIf(isCI)('watch --json e2e', () => {
  test('receives events as NDJSON lines', async () => {
    await withWatchJson(async lines => {
      await emitAll([
        { project: 'test-proj', status: 'start', step: 'sync' },
        { detail: 'done', project: 'test-proj', status: 'ok', step: 'sync' }
      ])
      await wait(500)
      expect(lines.length).toBeGreaterThanOrEqual(2)
      const parsed = lines.map(l => parseJson<WatchEvent>(l))
      expect(parsed[0]?.project).toBe('test-proj')
      expect(parsed[0]?.step).toBe('sync')
      expect(parsed[0]?.status).toBe('start')
      expect(parsed[1]?.status).toBe('ok')
      expect(parsed[1]?.detail).toBe('done')
    })
  })
  test('each line is valid JSON with required fields', async () => {
    const expectEventShape = (line: string) => {
      const e = parseJson<WatchEvent>(line)
      expect(e).toHaveProperty('at')
      expect(e).toHaveProperty('project')
      expect(e).toHaveProperty('step')
      expect(e).toHaveProperty('status')
      expect(typeof e.at).toBe('string')
    }
    await withWatchJson(async lines => {
      await emitAll([
        { project: 'p1', status: 'start', step: 'audit' },
        { project: 'p2', status: 'ok', step: 'check' },
        { detail: 'clean', project: 'p1', status: 'ok', step: 'done' }
      ])
      await wait(500)
      expect(lines).toHaveLength(3)
      for (const line of lines) expectEventShape(line)
    })
  })
  test('handles rapid burst of events', async () => {
    await withWatchJson(async lines => {
      for (let i = 0; i < 20; i += 1)
        await emitToSocket(createEvent({ project: `proj-${i}`, status: 'start', step: 'sync' }))
      await wait(1000)
      expect(lines).toHaveLength(20)
      const projects = new Set(lines.map(l => parseJson<WatchEvent>(l).project))
      expect(projects.size).toBe(20)
    })
  })
  test('full fix lifecycle for a project', async () => {
    await withWatchJson(async lines => {
      await emitAll(lifecycle.map(([project, step, status, detail]) => ({ detail, project, status, step })))
      await wait(500)
      expect(lines).toHaveLength(7)
      const events = lines.map(l => parseJson<WatchEvent>(l))
      expect(events[0]?.step).toBe('sync')
      expect(events[0]?.status).toBe('start')
      expect(events[1]?.detail).toBe('3 synced')
      expect(events[5]?.detail).toBe('2 fixed')
      expect(events[6]?.step).toBe('done')
      expect(events[6]?.detail).toBe('clean')
    })
  })
  test('multiple projects interleaved', async () => {
    await withWatchJson(async lines => {
      await emitAll([
        { project: 'a', status: 'start', step: 'sync' },
        { project: 'b', status: 'start', step: 'sync' },
        { project: 'a', status: 'ok', step: 'sync' },
        { project: 'b', status: 'ok', step: 'sync' },
        { detail: 'clean', project: 'a', status: 'ok', step: 'done' },
        { detail: 'clean', project: 'b', status: 'ok', step: 'done' }
      ])
      await wait(500)
      expect(lines).toHaveLength(6)
      const events = lines.map(l => parseJson<WatchEvent>(l))
      const aEvents = events.filter(e => e.project === 'a')
      const bEvents = events.filter(e => e.project === 'b')
      expect(aEvents).toHaveLength(3)
      expect(bEvents).toHaveLength(3)
    })
  })
  test('fail status events are received correctly', async () => {
    await withWatchJson(async lines => {
      await emitAll([
        { project: 'broken', status: 'start', step: 'check' },
        { detail: '5 violations', project: 'broken', status: 'fail', step: 'check' },
        { detail: '5 violations', project: 'broken', status: 'fail', step: 'done' }
      ])
      await wait(500)
      expect(lines).toHaveLength(3)
      const events = lines.map(l => parseJson<WatchEvent>(l))
      expect(events[1]?.status).toBe('fail')
      expect(events[1]?.detail).toBe('5 violations')
      expect(events[2]?.step).toBe('done')
      expect(events[2]?.status).toBe('fail')
    })
  })
})
