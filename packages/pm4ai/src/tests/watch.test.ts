/* eslint-disable @typescript-eslint/no-empty-function */
import { file } from 'bun'
import { describe, expect, test } from 'bun:test'
import { createConnection } from 'node:net'
import type { WatchEvent } from '../watch-types.js'
import { parseJson } from '../json.js'
import { emit, SOCKET_PATH, startEmitter, stopEmitter } from '../watch-emitter.js'
import { createEvent } from '../watch-types.js'
const wait = async (ms: number): Promise<void> =>
  new Promise(r => {
    setTimeout(r, ms)
  })
const connectAndRead = async (count: number): Promise<WatchEvent[]> =>
  new Promise(resolve => {
    const events: WatchEvent[] = []
    let buffer = ''
    const sock = createConnection(SOCKET_PATH)
    sock.on('data', chunk => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines)
        if (line) {
          events.push(parseJson<WatchEvent>(line))
          if (events.length >= count) {
            sock.destroy()
            resolve(events)
          }
        }
    })
    sock.on('error', () => {})
  })
const withStoppedEmitter = async (run: () => Promise<void>) => {
  try {
    await run()
  } finally {
    await stopEmitter()
  }
}
const startListening = async (count: number) => {
  await startEmitter()
  const eventsPromise = connectAndRead(count)
  await wait(50)
  return { eventsPromise }
}
type EventInput = Parameters<typeof createEvent>[0]
const emitAll = (events: EventInput[]) => {
  for (const event of events) emit(createEvent(event))
}
const fixSteps: [string, 'audit' | 'done' | 'maintain' | 'sync', 'fail' | 'ok' | 'start'][] = [
  ['proj', 'sync', 'start'],
  ['proj', 'sync', 'ok'],
  ['proj', 'audit', 'start'],
  ['proj', 'audit', 'ok'],
  ['proj', 'maintain', 'start'],
  ['proj', 'maintain', 'ok'],
  ['proj', 'done', 'ok']
]
describe('watch event protocol', () => {
  test('fix sequence: sync→audit→maintain→done per project', async () => {
    await withStoppedEmitter(async () => {
      const { eventsPromise } = await startListening(8)
      emitAll([
        ...fixSteps.map(([project, step, status]) => ({ project, status, step })),
        { detail: 'clean', project: 'proj', status: 'ok', step: 'done' }
      ])
      const events = await eventsPromise
      expect(events).toHaveLength(8)
      expect(events[0]?.step).toBe('sync')
      expect(events[0]?.status).toBe('start')
      expect(events[7]?.step).toBe('done')
      expect(events[7]?.detail).toBe('clean')
    })
  })
  test('parallel projects emit interleaved events', async () => {
    await withStoppedEmitter(async () => {
      const { eventsPromise } = await startListening(4)
      emitAll([
        { project: 'a', status: 'start', step: 'sync' },
        { project: 'b', status: 'start', step: 'sync' },
        { project: 'a', status: 'ok', step: 'sync' },
        { project: 'b', status: 'ok', step: 'sync' }
      ])
      const events = await eventsPromise
      const aEvents = events.filter(e => e.project === 'a')
      const bEvents = events.filter(e => e.project === 'b')
      expect(aEvents).toHaveLength(2)
      expect(bEvents).toHaveLength(2)
    })
  })
  test('status sequence: check→done per project', async () => {
    await withStoppedEmitter(async () => {
      const { eventsPromise } = await startListening(4)
      emitAll([
        { project: 'proj', status: 'start', step: 'check' },
        { detail: '3 issues', project: 'proj', status: 'fail', step: 'check' },
        { detail: '3 issues', project: 'proj', status: 'fail', step: 'done' },
        { detail: 'clean', project: 'other', status: 'ok', step: 'done' }
      ])
      const events = await eventsPromise
      expect(events[0]?.step).toBe('check')
      expect(events[1]?.status).toBe('fail')
      expect(events[1]?.detail).toBe('3 issues')
      expect(events[3]?.project).toBe('other')
    })
  })
  test('event timestamps are monotonically increasing', async () => {
    await withStoppedEmitter(async () => {
      const { eventsPromise } = await startListening(5)
      for (let i = 0; i < 5; i += 1) emit(createEvent({ project: 'p', status: 'start', step: 'sync' }))
      const events = await eventsPromise
      for (let i = 1; i < events.length; i += 1)
        expect(new Date(events[i]?.at ?? '').getTime()).toBeGreaterThanOrEqual(new Date(events[i - 1]?.at ?? '').getTime())
    })
  })
  test('events with detail vs without detail', async () => {
    await withStoppedEmitter(async () => {
      const { eventsPromise } = await startListening(2)
      emit(createEvent({ project: 'p', status: 'start', step: 'sync' }))
      emit(createEvent({ detail: '3 synced', project: 'p', status: 'ok', step: 'sync' }))
      const events = await eventsPromise
      expect('detail' in (events[0] ?? {})).toBe(false)
      expect(events[1]?.detail).toBe('3 synced')
    })
  })
})
describe('watch --json via CLI', () => {
  test('cli watch command exists in dist', async () => {
    const { join } = await import('node:path')
    const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs')
    expect(await file(cliPath).exists()).toBe(true)
  })
})
