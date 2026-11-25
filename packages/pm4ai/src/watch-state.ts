/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import type { WatchEvent } from './watch-types.js'
interface DerivedStats {
  completedStepCount: number
  done: number
  eta?: number
  failed: number
  running: number
  slowestElapsed: number
  slowestName: string
}
interface ProjectInfo {
  name: string
  path: string
}
interface ProjectState {
  cachedPass?: boolean
  completedSteps: Set<string>
  detail?: string
  elapsed: number
  startedAt?: number
  status: 'done' | 'failed' | 'idle' | 'running'
  step?: string
}
type RunAction =
  | { event: WatchEvent; type: 'event' }
  | { focused: string; type: 'focus' }
  | { mkIdle: (p: ProjectInfo) => ProjectState; projects: ProjectInfo[]; type: 'reset' }
  | { type: 'bell-acked' }
  | { type: 'tick' }
interface RunState {
  bellPending: boolean
  elapsed: number
  focused: string
  history: number[]
  lastDone: number
  lastElapsed: number
  lastFailed: number
  lastTime: string
  phase: 'done' | 'idle' | 'running'
  projects: Record<string, ProjectState>
  runCount: number
  sortSnapshot: string[]
  startTime?: number
}
const RESET_DELAY = 5000
const DISPLAY_STEPS = ['sync', 'audit', 'maintain', 'check'] as const
const STEP_COUNT = DISPLAY_STEPS.length
const STEP_LABELS = {
  audit: '🔍 auditing',
  check: '🧪 checking',
  maintain: '🔧 maintaining',
  sync: '📦 syncing'
} as const satisfies Record<string, string>
const STATUS_ORDER = { done: 1, failed: 2, idle: 3, running: 0 } as const
const BAR_CHARS = ' ▏▎▍▌▋▊▉█' as const
const BAR_FULL = BAR_CHARS.at(-1) ?? '█'
const SPARK_CHARS = '▁▂▃▄▅▆▇█' as const
const SPARK_ZERO = SPARK_CHARS[0] ?? '▁'
const MAX_HISTORY = 8
const IDLE_FALLBACK: ProjectState = { completedSteps: new Set<string>(), elapsed: 0, status: 'idle' }
const smoothBar = (fraction: number, width: number): string => {
  const clamped = Math.min(1, Math.max(0, fraction))
  const total = clamped * width
  const full = Math.floor(total)
  const partial = total - full
  const partialIdx = Math.round(partial * (BAR_CHARS.length - 1))
  const partialChar = partialIdx > 0 && full < width ? (BAR_CHARS[partialIdx] ?? '') : ''
  const filled = full + (partialChar ? 1 : 0)
  const empty = Math.max(0, width - filled)
  return `${BAR_FULL.repeat(full)}${partialChar}${'░'.repeat(empty)}`
}
const sparkline = (values: number[]): string => {
  if (values.length === 0) return ''
  let max = 0
  for (const v of values) if (v > max) max = v
  if (max === 0) return SPARK_ZERO.repeat(values.length)
  return values.map(v => SPARK_CHARS[Math.round((v / max) * (SPARK_CHARS.length - 1))] ?? SPARK_ZERO).join('')
}
const progressDots = (completed: Set<string>, current?: string): string => {
  const parts: string[] = []
  for (const s of DISPLAY_STEPS)
    if (completed.has(s)) parts.push('●')
    else if (s === current) parts.push('◌')
    else parts.push('·')
  return parts.join('')
}
const formatMinutes = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  const sPart = s > 0 ? `${s}s` : ''
  return `${m}m${sPart}`
}
const formatTime = (seconds: number): string => {
  if (seconds <= 0) return '<1s'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return formatMinutes(seconds)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const mPart = m > 0 ? `${m}m` : ''
  return `${h}h${mPart}`
}
const timeAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
const nextProjectState = (prev: ProjectState, event: WatchEvent): ProjectState => {
  if (event.step === 'done') {
    const projectElapsed = prev.startedAt ? Math.floor((Date.now() - prev.startedAt) / 1000) : 0
    return event.status === 'fail'
      ? { completedSteps: new Set(DISPLAY_STEPS), detail: event.detail, elapsed: projectElapsed, status: 'failed' }
      : {
          completedSteps: new Set(DISPLAY_STEPS),
          detail: event.detail ?? 'clean',
          elapsed: projectElapsed,
          status: 'done'
        }
  }
  if (event.status === 'start') {
    const isFreshStart = prev.status === 'done' || prev.status === 'failed' || prev.status === 'idle'
    return {
      completedSteps: isFreshStart ? new Set<string>() : prev.completedSteps,
      elapsed: 0,
      startedAt: isFreshStart ? Date.now() : (prev.startedAt ?? Date.now()),
      status: 'running',
      step: event.step
    }
  }
  if (event.status === 'fail')
    return {
      completedSteps: prev.completedSteps,
      detail: event.detail,
      elapsed: prev.elapsed,
      startedAt: prev.startedAt,
      status: 'running',
      step: event.step
    }
  const completed = prev.completedSteps.has(event.step)
    ? prev.completedSteps
    : new Set([...prev.completedSteps, event.step])
  return {
    completedSteps: completed,
    detail: event.detail,
    elapsed: prev.elapsed,
    startedAt: prev.startedAt,
    status: 'running',
    step: event.step
  }
}
const sortByStatus = (names: string[], projects: Record<string, ProjectState>): string[] =>
  [...names].toSorted((a, b) => {
    const sa = projects[a]?.status ?? 'idle'
    const sb = projects[b]?.status ?? 'idle'
    return (STATUS_ORDER[sa] ?? 9) - (STATUS_ORDER[sb] ?? 9)
  })
const tickProject = (v: ProjectState, now: number): ProjectState => {
  if (v.status !== 'running' || v.startedAt === undefined) return v
  const elapsed = Math.floor((now - v.startedAt) / 1000)
  return elapsed === v.elapsed ? v : { ...v, elapsed }
}
const tickProjects = (projects: Record<string, ProjectState>): Record<string, ProjectState> => {
  const now = Date.now()
  const entries = Object.entries(projects).map(([k, v]) => [k, tickProject(v, now)] as const)
  const hasChanged = entries.some(([k, v]) => v !== projects[k])
  return hasChanged ? Object.fromEntries(entries) : projects
}
const countStatus = (states: ProjectState[], status: ProjectState['status']): number =>
  states.filter(s => s.status === status).length
const isFinished = (s: ProjectState): boolean => s.status === 'done' || s.status === 'failed'
const resetState = (state: RunState, action: Extract<RunAction, { type: 'reset' }>): RunState => {
  const newProjects = Object.fromEntries(action.projects.map(p => [p.name, action.mkIdle(p)]))
  const previous = Object.values(state.projects)
  const snapshot = sortByStatus(Object.keys(newProjects), newProjects)
  return {
    ...state,
    bellPending: false,
    elapsed: 0,
    focused: snapshot[0] ?? state.focused,
    history: state.elapsed > 0 ? [...state.history, state.elapsed].slice(-MAX_HISTORY) : state.history,
    lastDone: countStatus(previous, 'done'),
    lastElapsed: state.elapsed,
    lastFailed: countStatus(previous, 'failed'),
    lastTime: new Date().toLocaleTimeString(),
    phase: 'idle',
    projects: newProjects,
    runCount: state.runCount + 1,
    sortSnapshot: snapshot,
    startTime: undefined
  }
}
const nextPhase = (current: RunState['phase'], projects: Record<string, ProjectState>): RunState['phase'] => {
  const states = Object.values(projects)
  const finished = states.filter(isFinished).length
  if (finished === states.length && states.length > 0) return 'done'
  if (states.some(s => s.status === 'running')) return 'running'
  return current
}
const isNextBellPending = (isBellPending: boolean, wasRunning: boolean, phase: RunState['phase']): boolean => {
  if (wasRunning && phase === 'done') return true
  if (phase === 'running') return false
  return isBellPending
}
const applyEvent = (state: RunState, event: WatchEvent): RunState => {
  const next = {
    ...state.projects,
    [event.project]: nextProjectState(state.projects[event.project] ?? IDLE_FALLBACK, event)
  }
  const startTime = event.status === 'start' ? (state.startTime ?? Date.now()) : state.startTime
  const wasRunning = state.phase === 'running'
  const phase = nextPhase(state.phase, next)
  const shouldResort = (!wasRunning && phase === 'running') || phase === 'done'
  const sortSnapshot = shouldResort ? sortByStatus(Object.keys(next), next) : state.sortSnapshot
  const focused =
    shouldResort && !sortSnapshot.includes(state.focused) ? (sortSnapshot[0] ?? state.focused) : state.focused
  return {
    ...state,
    bellPending: isNextBellPending(state.bellPending, wasRunning, phase),
    focused,
    phase,
    projects: next,
    sortSnapshot,
    startTime
  }
}
const tickState = (state: RunState): RunState => {
  if (!state.startTime) return state
  const projects = tickProjects(state.projects)
  return { ...state, elapsed: Math.floor((Date.now() - state.startTime) / 1000), projects }
}
const runReducer = (state: RunState, action: RunAction): RunState => {
  if (action.type === 'tick') return tickState(state)
  if (action.type === 'bell-acked') return state.bellPending ? { ...state, bellPending: false } : state
  if (action.type === 'focus') return state.focused === action.focused ? state : { ...state, focused: action.focused }
  if (action.type === 'reset') return resetState(state, action)
  return applyEvent(state, action.event)
}
const estimateEta = ({
  elapsed,
  history,
  lastElapsed,
  runningCount
}: {
  elapsed: number
  history: number[]
  lastElapsed: number
  runningCount: number
}): number | undefined => {
  if (runningCount === 0) return
  if (history.length > 0) {
    let sum = 0
    for (const h of history) sum += h
    return Math.max(0, Math.round(sum / history.length - elapsed))
  }
  if (lastElapsed > 0) return Math.max(0, lastElapsed - elapsed)
}
const totalCompletedSteps = (states: ProjectState[], failedCount: number): number => {
  let steps = failedCount * STEP_COUNT
  for (const s of states) steps += s.completedSteps.size
  return steps
}
const deriveStats = ({
  elapsed,
  history,
  lastElapsed,
  projects
}: {
  elapsed: number
  history: number[]
  lastElapsed: number
  projects: Record<string, ProjectState>
}): DerivedStats => {
  const states = Object.values(projects)
  const runningCount = countStatus(states, 'running')
  const failedCount = countStatus(states, 'failed')
  const finished = Object.entries(projects).filter(([, s]) => isFinished(s))
  const maxE = Math.max(0, ...finished.map(([, s]) => s.elapsed))
  const maxN = maxE > 0 ? (finished.find(([, s]) => s.elapsed === maxE)?.[0] ?? '') : ''
  return {
    completedStepCount: totalCompletedSteps(states, failedCount),
    done: countStatus(states, 'done'),
    eta: estimateEta({ elapsed, history, lastElapsed, runningCount }),
    failed: failedCount,
    running: runningCount,
    slowestElapsed: maxE,
    slowestName: maxN
  }
}
const createInitState = (projects: ProjectInfo[], mkIdle: (p: ProjectInfo) => ProjectState): RunState => {
  const initial = Object.fromEntries(projects.map(p => [p.name, mkIdle(p)]))
  const snapshot = sortByStatus(Object.keys(initial), initial)
  return {
    bellPending: false,
    elapsed: 0,
    focused: snapshot[0] ?? '',
    history: [],
    lastDone: 0,
    lastElapsed: 0,
    lastFailed: 0,
    lastTime: '',
    phase: 'idle',
    projects: initial,
    runCount: 0,
    sortSnapshot: snapshot,
    startTime: undefined
  }
}
export {
  createInitState,
  deriveStats,
  DISPLAY_STEPS,
  formatTime,
  IDLE_FALLBACK,
  MAX_HISTORY,
  nextProjectState,
  progressDots,
  RESET_DELAY,
  runReducer,
  smoothBar,
  sortByStatus,
  sparkline,
  STATUS_ORDER,
  STEP_COUNT,
  STEP_LABELS,
  tickProjects,
  timeAgo
}
export type { DerivedStats, ProjectInfo, ProjectState, RunAction, RunState }
