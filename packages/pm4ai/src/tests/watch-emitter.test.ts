/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential by design */
/* oxlint-disable no-empty-function, eslint-plugin-promise(param-names) */
/* eslint-disable @typescript-eslint/strict-void-return, no-await-in-loop, @typescript-eslint/no-unsafe-return, no-promise-executor-return */
import type { Socket } from 'node:net'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import type { WatchEvent } from '../watch-types.js'
import { clients, emit, SOCKET_PATH, startEmitter, stopEmitter } from '../watch-emitter.js'
import { createEvent } from '../watch-types.js'
const wait = async (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const connectClient = async (): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const sock = createConnection(SOCKET_PATH)
    sock.on('connect', () => resolve(sock))
    sock.on('error', reject)
  })
const readEvents = async (sock: Socket, count: number): Promise<WatchEvent[]> =>
  new Promise(resolve => {
    const events: WatchEvent[] = []
    let buffer = ''
    sock.on('data', chunk => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines)
        if (line) {
          events.push(JSON.parse(line) as WatchEvent)
          if (events.length >= count) resolve(events)
        }
    })
  })
const ev = (project: string, step: 'audit' | 'check' | 'done' | 'maintain' | 'sync', status: 'fail' | 'ok' | 'start') =>
  createEvent({ project, status, step })
afterEach(async () => {
  await stopEmitter()
})
describe('socket lifecycle', () => {
  test('creates socket at expected path', async () => {
    await startEmitter()
    expect(existsSync(SOCKET_PATH)).toBe(true)
  })
  test('cleans up socket on stop', async () => {
    await startEmitter()
    await stopEmitter()
    expect(existsSync(SOCKET_PATH)).toBe(false)
  })
  test('handles stale socket file', async () => {
    await startEmitter()
    await stopEmitter()
    writeFileSync(SOCKET_PATH, 'stale')
    await startEmitter()
    expect(existsSync(SOCKET_PATH)).toBe(true)
  })
  test('multiple start/stop cycles', async () => {
    for (let i = 0; i < 3; i += 1) {
      await startEmitter()
      await stopEmitter()
    }
    expect(existsSync(SOCKET_PATH)).toBe(false)
  })
  test('second start is no-op', async () => {
    await startEmitter()
    await startEmitter()
    expect(existsSync(SOCKET_PATH)).toBe(true)
  })
})
describe('event delivery', () => {
  test('single client receives event', async () => {
    await startEmitter()
    const sock = await connectClient()
    const eventsPromise = readEvents(sock, 1)
    emit(ev('lintmax', 'sync', 'start'))
    const events = await eventsPromise
    expect(events).toHaveLength(1)
    expect(events[0]?.project).toBe('lintmax')
    sock.destroy()
  })
  test('multiple clients each receive all events', async () => {
    await startEmitter()
    const socks = await Promise.all([connectClient(), connectClient(), connectClient()])
    const promises = socks.map(async s => readEvents(s, 2))
    emit(ev('a', 'sync', 'start'))
    emit(ev('b', 'audit', 'ok'))
    const results = await Promise.all(promises)
    for (const events of results) {
      expect(events).toHaveLength(2)
      expect(events[0]?.project).toBe('a')
      expect(events[1]?.project).toBe('b')
    }
    for (const s of socks) s.destroy()
  })
  test('events are valid newline-delimited JSON', async () => {
    await startEmitter()
    const sock = await connectClient()
    const raw: string[] = []
    sock.on('data', chunk => raw.push(chunk.toString()))
    emit(ev('test', 'sync', 'start'))
    emit(ev('test', 'sync', 'ok'))
    await wait(50)
    const combined = raw.join('')
    const lines = combined.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow()
    sock.destroy()
  })
  test('events arrive in emission order', async () => {
    await startEmitter()
    const sock = await connectClient()
    const eventsPromise = readEvents(sock, 3)
    emit(ev('a', 'sync', 'start'))
    emit(ev('a', 'audit', 'start'))
    emit(ev('a', 'maintain', 'start'))
    const events = await eventsPromise
    expect(events.map(e => e.step)).toEqual(['sync', 'audit', 'maintain'])
    sock.destroy()
  })
})
describe('no-client behavior', () => {
  test('emit is no-op with no clients', async () => {
    await startEmitter()
    expect(() => emit(ev('test', 'sync', 'start'))).not.toThrow()
  })
  test('no errors on burst with no clients', async () => {
    await startEmitter()
    for (let i = 0; i < 1000; i += 1) emit(ev('test', 'sync', 'start'))
    expect(true).toBe(true)
  })
  test('performance: 10k emits with no client under 50ms', async () => {
    await startEmitter()
    const start = performance.now()
    for (let i = 0; i < 10_000; i += 1) emit(ev('test', 'sync', 'start'))
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
  })
})
describe('client disconnect', () => {
  test('disconnect does not crash emitter', async () => {
    await startEmitter()
    const sock = await connectClient()
    sock.destroy()
    await wait(50)
    expect(() => emit(ev('test', 'sync', 'start'))).not.toThrow()
  })
  test('remaining clients still receive after one disconnects', async () => {
    await startEmitter()
    const sock1 = await connectClient()
    const sock2 = await connectClient()
    sock1.destroy()
    await wait(50)
    const eventsPromise = readEvents(sock2, 1)
    emit(ev('test', 'done', 'ok'))
    const events = await eventsPromise
    expect(events).toHaveLength(1)
    sock2.destroy()
  })
  test('all clients disconnect returns to idle', async () => {
    await startEmitter()
    const sock = await connectClient()
    expect(clients.size).toBe(1)
    sock.destroy()
    await wait(50)
    expect(clients.size).toBe(0)
  })
})
describe('hostile client', () => {
  test('client sending data does not crash emitter', async () => {
    await startEmitter()
    const sock = await connectClient()
    sock.write('garbage data\n')
    await wait(50)
    expect(() => emit(ev('test', 'sync', 'start'))).not.toThrow()
    sock.destroy()
  })
  test('client sending malformed data is ignored', async () => {
    await startEmitter()
    const sock = await connectClient()
    sock.write(Buffer.alloc(1024))
    await wait(50)
    const eventsPromise = readEvents(sock, 1)
    emit(ev('test', 'done', 'ok'))
    const events = await eventsPromise
    expect(events).toHaveLength(1)
    sock.destroy()
  })
})
describe('reconnecting client', () => {
  test('reconnecting client receives only new events', async () => {
    await startEmitter()
    const sock1 = await connectClient()
    emit(ev('a', 'sync', 'start'))
    await wait(50)
    sock1.destroy()
    await wait(50)
    const sock2 = await connectClient()
    const eventsPromise = readEvents(sock2, 1)
    emit(ev('b', 'audit', 'ok'))
    const events = await eventsPromise
    expect(events).toHaveLength(1)
    expect(events[0]?.project).toBe('b')
    sock2.destroy()
  })
})
describe('event burst', () => {
  test('handles burst of 100 events with client', async () => {
    await startEmitter()
    const sock = await connectClient()
    const eventsPromise = readEvents(sock, 100)
    for (let i = 0; i < 100; i += 1) emit(ev(`p${i}`, 'sync', 'start'))
    const events = await eventsPromise
    expect(events).toHaveLength(100)
    expect(events[0]?.project).toBe('p0')
    expect(events[99]?.project).toBe('p99')
    sock.destroy()
  })
})
describe('concurrent clients', () => {
  test('5 clients each receive all events independently', async () => {
    await startEmitter()
    const socks = await Promise.all(Array.from({ length: 5 }, async () => connectClient()))
    const promises = socks.map(async s => readEvents(s, 3))
    emit(ev('x', 'sync', 'start'))
    emit(ev('x', 'sync', 'ok'))
    emit(ev('x', 'done', 'ok'))
    const results = await Promise.all(promises)
    for (const events of results) {
      expect(events).toHaveLength(3)
      expect(events.map(e => e.step)).toEqual(['sync', 'sync', 'done'])
    }
    for (const s of socks) s.destroy()
  })
})
describe('event content', () => {
  test('event fields match WatchEvent interface', async () => {
    await startEmitter()
    const sock = await connectClient()
    const eventsPromise = readEvents(sock, 1)
    emit(createEvent({ detail: 'done', project: 'test', status: 'ok', step: 'sync' }))
    const events = await eventsPromise
    const event = events[0]
    expect(event).toBeDefined()
    expect(typeof event?.at).toBe('string')
    expect(typeof event?.project).toBe('string')
    expect(typeof event?.step).toBe('string')
    expect(typeof event?.status).toBe('string')
    expect(typeof event?.detail).toBe('string')
    sock.destroy()
  })
  test('event without detail omits detail field', async () => {
    await startEmitter()
    const sock = await connectClient()
    const eventsPromise = readEvents(sock, 1)
    emit(createEvent({ project: 'test', status: 'start', step: 'sync' }))
    const events = await eventsPromise
    expect('detail' in (events[0] ?? {})).toBe(false)
    sock.destroy()
  })
})
