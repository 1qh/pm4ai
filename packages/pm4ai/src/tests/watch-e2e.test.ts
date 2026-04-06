/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional */
/** biome-ignore-all lint/style/noProcessEnv: CI detection */
/** biome-ignore-all lint/performance/noAwaitInLoops: polling */
/* oxlint-disable no-empty-function, eslint-plugin-promise(param-names), no-await-in-loop */
/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/strict-void-return, no-promise-executor-return, @typescript-eslint/no-unnecessary-condition, no-await-in-loop */
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WatchEvent } from '../watch-types.js'
import { emitToSocket, SOCKET_PATH, stopEmitter } from '../watch-emitter.js'
import { createEvent } from '../watch-types.js'
const isCI = 'CI' in process.env
const wait = async (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.js')
const waitForSocket = async (timeout = 5000): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (existsSync(SOCKET_PATH)) return
    await wait(100)
  }
  throw new Error('watch.sock not created in time')
}
describe.skipIf(isCI)('watch --json e2e', () => {
  let proc: ChildProcess | undefined
  afterEach(async () => {
    proc?.kill()
    proc = undefined
    await stopEmitter()
    await wait(200)
  })
  const spawnWatchJson = async (): Promise<{ lines: string[]; process: ChildProcess }> => {
    const lines: string[] = []
    const p = spawn('bun', ['run', cliPath, 'watch', '--json'], { stdio: ['pipe', 'pipe', 'pipe'] })
    proc = p
    let buffer = ''
    p.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const line of parts) if (line.trim()) lines.push(line)
    })
    p.stderr?.on('data', () => {})
    await waitForSocket()
    await wait(200)
    return { lines, process: p }
  }
  test('receives events as NDJSON lines', async () => {
    const { lines } = await spawnWatchJson()
    emitToSocket(createEvent({ project: 'test-proj', status: 'start', step: 'sync' }))
    emitToSocket(createEvent({ detail: 'done', project: 'test-proj', status: 'ok', step: 'sync' }))
    await wait(500)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    const parsed = lines.map(l => JSON.parse(l) as WatchEvent)
    expect(parsed[0]?.project).toBe('test-proj')
    expect(parsed[0]?.step).toBe('sync')
    expect(parsed[0]?.status).toBe('start')
    expect(parsed[1]?.status).toBe('ok')
    expect(parsed[1]?.detail).toBe('done')
  })
  test('each line is valid JSON with required fields', async () => {
    const { lines } = await spawnWatchJson()
    emitToSocket(createEvent({ project: 'p1', status: 'start', step: 'audit' }))
    emitToSocket(createEvent({ project: 'p2', status: 'ok', step: 'check' }))
    emitToSocket(createEvent({ detail: 'clean', project: 'p1', status: 'ok', step: 'done' }))
    await wait(500)
    expect(lines.length).toBe(3)
    for (const line of lines) {
      const e = JSON.parse(line) as WatchEvent
      expect(e).toHaveProperty('at')
      expect(e).toHaveProperty('project')
      expect(e).toHaveProperty('step')
      expect(e).toHaveProperty('status')
      expect(typeof e.at).toBe('string')
    }
  })
  test('handles rapid burst of events', async () => {
    const { lines } = await spawnWatchJson()
    for (let i = 0; i < 20; i += 1) emitToSocket(createEvent({ project: `proj-${i}`, status: 'start', step: 'sync' }))
    await wait(1000)
    expect(lines.length).toBe(20)
    const projects = new Set(lines.map(l => (JSON.parse(l) as WatchEvent).project))
    expect(projects.size).toBe(20)
  })
  test('full fix lifecycle for a project', async () => {
    const { lines } = await spawnWatchJson()
    const lifecycle: [string, 'audit' | 'done' | 'maintain' | 'sync', 'fail' | 'ok' | 'start', string?][] = [
      ['myapp', 'sync', 'start'],
      ['myapp', 'sync', 'ok', '3 synced'],
      ['myapp', 'audit', 'start'],
      ['myapp', 'audit', 'ok'],
      ['myapp', 'maintain', 'start'],
      ['myapp', 'maintain', 'ok', '2 fixed'],
      ['myapp', 'done', 'ok', 'clean']
    ]
    for (const [project, step, status, detail] of lifecycle) emitToSocket(createEvent({ detail, project, status, step }))
    await wait(500)
    expect(lines.length).toBe(7)
    const events = lines.map(l => JSON.parse(l) as WatchEvent)
    expect(events[0]?.step).toBe('sync')
    expect(events[0]?.status).toBe('start')
    expect(events[1]?.detail).toBe('3 synced')
    expect(events[5]?.detail).toBe('2 fixed')
    expect(events[6]?.step).toBe('done')
    expect(events[6]?.detail).toBe('clean')
  })
  test('multiple projects interleaved', async () => {
    const { lines } = await spawnWatchJson()
    emitToSocket(createEvent({ project: 'a', status: 'start', step: 'sync' }))
    emitToSocket(createEvent({ project: 'b', status: 'start', step: 'sync' }))
    emitToSocket(createEvent({ project: 'a', status: 'ok', step: 'sync' }))
    emitToSocket(createEvent({ project: 'b', status: 'ok', step: 'sync' }))
    emitToSocket(createEvent({ detail: 'clean', project: 'a', status: 'ok', step: 'done' }))
    emitToSocket(createEvent({ detail: 'clean', project: 'b', status: 'ok', step: 'done' }))
    await wait(500)
    expect(lines.length).toBe(6)
    const events = lines.map(l => JSON.parse(l) as WatchEvent)
    const aEvents = events.filter(e => e.project === 'a')
    const bEvents = events.filter(e => e.project === 'b')
    expect(aEvents).toHaveLength(3)
    expect(bEvents).toHaveLength(3)
  })
  test('fail status events are received correctly', async () => {
    const { lines } = await spawnWatchJson()
    emitToSocket(createEvent({ project: 'broken', status: 'start', step: 'check' }))
    emitToSocket(createEvent({ detail: '5 violations', project: 'broken', status: 'fail', step: 'check' }))
    emitToSocket(createEvent({ detail: '5 violations', project: 'broken', status: 'fail', step: 'done' }))
    await wait(500)
    expect(lines.length).toBe(3)
    const events = lines.map(l => JSON.parse(l) as WatchEvent)
    expect(events[1]?.status).toBe('fail')
    expect(events[1]?.detail).toBe('5 violations')
    expect(events[2]?.step).toBe('done')
    expect(events[2]?.status).toBe('fail')
  })
})
