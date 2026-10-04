import { describe, expect, test } from 'bun:test'
import type { WatchStatus, WatchStep } from '../watch-types.js'
import { createEvent, WATCH_STATUSES, WATCH_STEPS } from '../watch-types.js'
describe('WATCH_STEPS', () => {
  test('contains all step values', () => {
    expect(WATCH_STEPS).toEqual(['audit', 'check', 'done', 'maintain', 'sync'])
  })
})
describe('WATCH_STATUSES', () => {
  test('contains all status values', () => {
    expect(WATCH_STATUSES).toEqual(['fail', 'ok', 'start'])
  })
})
describe('createEvent', () => {
  test('creates event with required fields', () => {
    const event = createEvent({ project: 'lintmax', status: 'start', step: 'sync' })
    expect(event.project).toBe('lintmax')
    expect(event.step).toBe('sync')
    expect(event.status).toBe('start')
    expect(event.at).toBeDefined()
    expect(event.detail).toBeUndefined()
  })
  test('creates event with detail', () => {
    const event = createEvent({ detail: '3 synced', project: 'ogrid', status: 'ok', step: 'sync' })
    expect(event.detail).toBe('3 synced')
  })
  test('at is valid ISO 8601', () => {
    const event = createEvent({ project: 'test', status: 'ok', step: 'done' })
    const parsed = new Date(event.at)
    expect(parsed.toISOString()).toBe(event.at)
  })
  test('omits detail key when undefined', () => {
    const event = createEvent({ project: 'test', status: 'start', step: 'sync' })
    expect('detail' in event).toBe(false)
  })
  test('includes detail key when provided', () => {
    const event = createEvent({ detail: 'done', project: 'test', status: 'ok', step: 'sync' })
    expect('detail' in event).toBe(true)
  })
  test('JSON round-trip preserves all fields', () => {
    const event = createEvent({ detail: 'up.sh failed', project: 'lintmax', status: 'fail', step: 'maintain' })
    const parsed = structuredClone(event)
    expect(parsed.project).toBe(event.project)
    expect(parsed.step).toBe(event.step)
    expect(parsed.status).toBe(event.status)
    expect(parsed.at).toBe(event.at)
    expect(parsed.detail).toBe(event.detail)
  })
  test('all step values accepted', () => {
    for (const step of WATCH_STEPS) {
      const event = createEvent({ project: 'test', status: 'ok', step })
      expect(event.step).toBe(step)
    }
  })
  test('all status values accepted', () => {
    for (const status of WATCH_STATUSES) {
      const event = createEvent({ project: 'test', status, step: 'sync' })
      expect(event.status).toBe(status)
    }
  })
  test('project with unicode characters', () => {
    const event = createEvent({ project: '日本語', status: 'start', step: 'sync' })
    expect(event.project).toBe('日本語')
  })
  test('detail with long string', () => {
    const long = 'x'.repeat(10_000)
    const event = createEvent({ detail: long, project: 'test', status: 'ok', step: 'done' })
    expect(event.detail?.length).toBe(10_000)
  })
  test('JSON serialization is deterministic', () => {
    const a = createEvent({ detail: 'detail', project: 'test', status: 'ok', step: 'sync' })
    const b = { ...a }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
describe('type exhaustiveness', () => {
  test('WatchStep union covers all values', () => {
    const steps: WatchStep[] = ['audit', 'check', 'done', 'maintain', 'sync']
    expect(steps).toHaveLength(5)
  })
  test('WatchStatus union covers all values', () => {
    const statuses: WatchStatus[] = ['fail', 'ok', 'start']
    expect(statuses).toHaveLength(3)
  })
})
