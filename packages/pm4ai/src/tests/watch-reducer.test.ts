import { describe, expect, test } from 'bun:test'
import { createEvent } from '../watch-types.js'
import {
  createInitState,
  deriveStats,
  formatTime,
  nextProjectState,
  runReducer,
  smoothBar,
  sparkline,
  tickProjects
} from '../watch.js'
const mkProject = (name: string) => ({ name, path: `/test/${name}` })
const mkProjects = (...names: string[]) => names.map(mkProject)
describe('runReducer', () => {
  test('tick returns same state when no startTime', () => {
    const projects = mkProjects('a')
    const state = createInitState(projects)
    const next = runReducer(state, { type: 'tick' })
    expect(next).toBe(state)
  })
  test('event transitions project to running', () => {
    const projects = mkProjects('a', 'b')
    const state = createInitState(projects)
    const event = createEvent({ project: 'a', status: 'start', step: 'sync' })
    const next = runReducer(state, { event, type: 'event' })
    expect(next.projects.a?.status).toBe('running')
    expect(next.projects.a?.step).toBe('sync')
    expect(next.phase).toBe('running')
    expect(next.startTime).toBeDefined()
  })
  test('done event transitions project to done', () => {
    const projects = mkProjects('a')
    let state = createInitState(projects)
    state = runReducer(state, { event: createEvent({ project: 'a', status: 'start', step: 'sync' }), type: 'event' })
    state = runReducer(state, {
      event: createEvent({ detail: 'clean', project: 'a', status: 'ok', step: 'done' }),
      type: 'event'
    })
    expect(state.projects.a?.status).toBe('done')
    expect(state.projects.a?.detail).toBe('clean')
    expect(state.phase).toBe('done')
  })
  test('fail event transitions project to failed', () => {
    const projects = mkProjects('a')
    let state = createInitState(projects)
    state = runReducer(state, { event: createEvent({ project: 'a', status: 'start', step: 'check' }), type: 'event' })
    state = runReducer(state, {
      event: createEvent({ detail: '3 issues', project: 'a', status: 'fail', step: 'done' }),
      type: 'event'
    })
    expect(state.projects.a?.status).toBe('failed')
    expect(state.projects.a?.detail).toBe('3 issues')
  })
  test('bellPending set on completion after running phase', () => {
    const projects = mkProjects('a')
    let state = createInitState(projects)
    state = runReducer(state, { event: createEvent({ project: 'a', status: 'start', step: 'sync' }), type: 'event' })
    expect(state.phase).toBe('running')
    expect(state.startTime).toBeDefined()
    state = runReducer(state, { event: createEvent({ project: 'a', status: 'ok', step: 'sync' }), type: 'event' })
    state = runReducer(state, {
      event: createEvent({ detail: 'clean', project: 'a', status: 'ok', step: 'done' }),
      type: 'event'
    })
    expect(state.phase).toBe('done')
    expect(state.bellPending).toBe(true)
  })
  test('bellPending not set when phase goes directly to done without running', () => {
    const projects = mkProjects('a')
    const state = createInitState(projects)
    expect(state.bellPending).toBe(false)
  })
  test('bell-acked clears bellPending', () => {
    const projects = mkProjects('a')
    let state = createInitState(projects)
    state = runReducer(state, { event: createEvent({ project: 'a', status: 'start', step: 'sync' }), type: 'event' })
    state = runReducer(state, { event: createEvent({ project: 'a', status: 'ok', step: 'sync' }), type: 'event' })
    state = runReducer(state, {
      event: createEvent({ detail: 'clean', project: 'a', status: 'ok', step: 'done' }),
      type: 'event'
    })
    expect(state.bellPending).toBe(true)
    state = runReducer(state, { type: 'bell-acked' })
    expect(state.bellPending).toBe(false)
  })
  test('reset increments runCount and records history', () => {
    const projects = mkProjects('a')
    let state = createInitState(projects)
    state = { ...state, elapsed: 42, phase: 'done', startTime: Date.now() - 42_000 }
    state = runReducer(state, {
      mkIdle: () => ({ completedSteps: new Set(), elapsed: 0, status: 'idle' }),
      projects,
      type: 'reset'
    })
    expect(state.runCount).toBe(1)
    expect(state.history).toContain(42)
    expect(state.phase).toBe('idle')
    expect(state.elapsed).toBe(0)
  })
  test('focus action updates focused name', () => {
    const projects = mkProjects('a', 'b')
    let state = createInitState(projects)
    state = runReducer(state, { focused: 'b', type: 'focus' })
    expect(state.focused).toBe('b')
  })
  test('focus action returns same ref when already focused', () => {
    const projects = mkProjects('a', 'b')
    const state = createInitState(projects)
    const next = runReducer(state, { focused: state.focused, type: 'focus' })
    expect(next).toBe(state)
  })
  test('bell-acked returns same ref when not pending', () => {
    const projects = mkProjects('a')
    const state = createInitState(projects)
    expect(state.bellPending).toBe(false)
    const next = runReducer(state, { type: 'bell-acked' })
    expect(next).toBe(state)
  })
  test('sortSnapshot updates on phase transitions', () => {
    const projects = mkProjects('a', 'b', 'c')
    let state = createInitState(projects)
    const initial = [...state.sortSnapshot]
    state = runReducer(state, { event: createEvent({ project: 'b', status: 'start', step: 'sync' }), type: 'event' })
    expect(state.sortSnapshot).not.toEqual(initial)
    expect(state.sortSnapshot[0]).toBe('b')
  })
})
describe('nextProjectState', () => {
  const idle = { completedSteps: new Set<string>(), elapsed: 0, status: 'idle' as const }
  test('start sets running', () => {
    const event = createEvent({ project: 'x', status: 'start', step: 'sync' })
    const next = nextProjectState(idle, event)
    expect(next.status).toBe('running')
    expect(next.step).toBe('sync')
    expect(next.startedAt).toBeDefined()
  })
  test('ok adds to completedSteps', () => {
    const running = {
      completedSteps: new Set<string>(),
      elapsed: 0,
      startedAt: Date.now(),
      status: 'running' as const,
      step: 'sync'
    }
    const event = createEvent({ project: 'x', status: 'ok', step: 'sync' })
    const next = nextProjectState(running, event)
    expect(next.completedSteps.has('sync')).toBe(true)
  })
  test('ok does not duplicate step in set', () => {
    const running = {
      completedSteps: new Set(['sync']),
      elapsed: 0,
      startedAt: Date.now(),
      status: 'running' as const,
      step: 'audit'
    }
    const event = createEvent({ project: 'x', status: 'ok', step: 'sync' })
    const next = nextProjectState(running, event)
    expect(next.completedSteps).toBe(running.completedSteps)
  })
  test('done with ok sets done status', () => {
    const running = {
      completedSteps: new Set(['sync']),
      elapsed: 0,
      startedAt: Date.now() - 5000,
      status: 'running' as const
    }
    const event = createEvent({ detail: 'clean', project: 'x', status: 'ok', step: 'done' })
    const next = nextProjectState(running, event)
    expect(next.status).toBe('done')
    expect(next.detail).toBe('clean')
    expect(next.elapsed).toBeGreaterThanOrEqual(4)
  })
  test('done with fail sets failed status', () => {
    const running = { completedSteps: new Set<string>(), elapsed: 0, startedAt: Date.now(), status: 'running' as const }
    const event = createEvent({ detail: '5 issues', project: 'x', status: 'fail', step: 'done' })
    const next = nextProjectState(running, event)
    expect(next.status).toBe('failed')
    expect(next.detail).toBe('5 issues')
  })
})
describe('deriveStats', () => {
  test('counts statuses correctly', () => {
    const projects = {
      a: { completedSteps: new Set(['audit', 'check', 'maintain', 'sync']), elapsed: 10, status: 'done' as const },
      b: { completedSteps: new Set(['sync']), elapsed: 0, status: 'running' as const },
      c: { completedSteps: new Set(['audit', 'sync']), elapsed: 5, status: 'failed' as const }
    }
    const stats = deriveStats({ elapsed: 15, history: [10, 12], lastElapsed: 12, projects })
    expect(stats.done).toBe(1)
    expect(stats.running).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.slowestName).toBe('a')
    expect(stats.slowestElapsed).toBe(10)
  })
  test('failed projects count as full steps for progress', () => {
    const projects = {
      a: { completedSteps: new Set(['audit', 'check', 'maintain', 'sync']), elapsed: 10, status: 'done' as const },
      b: { completedSteps: new Set(['sync']), elapsed: 5, status: 'failed' as const }
    }
    const stats = deriveStats({ elapsed: 10, history: [], lastElapsed: 0, projects })
    expect(stats.completedStepCount).toBe(4 + 4 + 1)
  })
  test('eta from history average', () => {
    const projects = { a: { completedSteps: new Set<string>(), elapsed: 0, status: 'running' as const } }
    const stats = deriveStats({ elapsed: 5, history: [10, 20], lastElapsed: 0, projects })
    expect(stats.eta).toBe(10)
  })
  test('eta from lastElapsed when no history', () => {
    const projects = { a: { completedSteps: new Set<string>(), elapsed: 0, status: 'running' as const } }
    const stats = deriveStats({ elapsed: 3, history: [], lastElapsed: 10, projects })
    expect(stats.eta).toBe(7)
  })
})
describe('tickProjects', () => {
  test('returns same reference when nothing changed', () => {
    const projects = { a: { completedSteps: new Set<string>(), elapsed: 0, status: 'idle' as const } }
    expect(tickProjects(projects)).toBe(projects)
  })
  test('updates elapsed for running projects', () => {
    const projects = {
      a: { completedSteps: new Set<string>(), elapsed: 0, startedAt: Date.now() - 5000, status: 'running' as const }
    }
    const next = tickProjects(projects)
    expect(next).not.toBe(projects)
    expect(next.a?.elapsed).toBeGreaterThanOrEqual(4)
  })
})
describe('utility functions', () => {
  test('smoothBar at 0%', () => {
    const bar = smoothBar(0, 10)
    expect(bar.length).toBe(10)
    expect(bar).not.toContain('█')
  })
  test('smoothBar at 100%', () => {
    const bar = smoothBar(1, 10)
    expect(bar).toContain('█')
    expect(bar).not.toContain('░')
  })
  test('smoothBar at 50% has both filled and empty', () => {
    const bar = smoothBar(0.5, 10)
    expect(bar).toContain('█')
    expect(bar).toContain('░')
  })
  test('sparkline with values', () => {
    const s = sparkline([1, 5, 3, 8, 2])
    expect(s.length).toBe(5)
    expect(s).toContain('█')
  })
  test('sparkline with zeros', () => {
    expect(sparkline([0, 0, 0])).toBe('▁▁▁')
  })
  test('sparkline empty', () => {
    expect(sparkline([])).toBe('')
  })
  test('formatTime seconds', () => {
    expect(formatTime(45)).toBe('45s')
  })
  test('formatTime zero', () => {
    expect(formatTime(0)).toBe('<1s')
  })
  test('formatTime minutes', () => {
    expect(formatTime(125)).toBe('2m5s')
  })
  test('formatTime hours', () => {
    expect(formatTime(3661)).toBe('1h1m')
  })
})
