/* eslint-disable @typescript-eslint/no-unnecessary-condition, complexity */
/* oxlint-disable complexity */
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
const formatTime = (seconds: number): string => {
  if (seconds <= 0) return '<1s'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m${s > 0 ? `${s}s` : ''}`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h${m > 0 ? `${m}m` : ''}`
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
    const freshStart = prev.status === 'done' || prev.status === 'failed' || prev.status === 'idle'
    return {
      completedSteps: freshStart ? new Set<string>() : prev.completedSteps,
      elapsed: 0,
      startedAt: freshStart ? Date.now() : (prev.startedAt ?? Date.now()),
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
const tickProjects = (projects: Record<string, ProjectState>): Record<string, ProjectState> => {
  const now = Date.now()
  let changed = false
  const next: Record<string, ProjectState> = {}
  for (const [k, v] of Object.entries(projects)) {
    const startedAt = v.status === 'running' ? v.startedAt : undefined
    const elapsed = startedAt === undefined ? v.elapsed : Math.floor((now - startedAt) / 1000)
    const shouldUpdate = startedAt !== undefined
    if (shouldUpdate && elapsed !== v.elapsed) {
      next[k] = { ...v, elapsed }
      changed = true
    } else next[k] = v
  }
  return changed ? next : projects
}
const runReducer = (state: RunState, action: RunAction): RunState => {
  if (action.type === 'tick') {
    if (!state.startTime) return state
    const projects = tickProjects(state.projects)
    return { ...state, elapsed: Math.floor((Date.now() - state.startTime) / 1000), projects }
  }
  if (action.type === 'bell-acked') return state.bellPending ? { ...state, bellPending: false } : state
  if (action.type === 'focus') return state.focused === action.focused ? state : { ...state, focused: action.focused }
  if (action.type === 'reset') {
    const newProjects = Object.fromEntries(action.projects.map(p => [p.name, action.mkIdle(p)]))
    let doneCount = 0
    let failedCount = 0
    for (const s of Object.values(state.projects)) {
      if (s.status === 'done') doneCount += 1
      if (s.status === 'failed') failedCount += 1
    }
    const snapshot = sortByStatus(Object.keys(newProjects), newProjects)
    return {
      ...state,
      bellPending: false,
      elapsed: 0,
      focused: snapshot[0] ?? state.focused,
      history: state.elapsed > 0 ? [...state.history, state.elapsed].slice(-MAX_HISTORY) : state.history,
      lastDone: doneCount,
      lastElapsed: state.elapsed,
      lastFailed: failedCount,
      lastTime: new Date().toLocaleTimeString(),
      phase: 'idle',
      projects: newProjects,
      runCount: state.runCount + 1,
      sortSnapshot: snapshot,
      startTime: undefined
    }
  }
  const { event } = action
  const prev = state.projects[event.project] ?? IDLE_FALLBACK
  const nextProj = nextProjectState(prev, event)
  const next = { ...state.projects, [event.project]: nextProj }
  const startTime = event.status === 'start' ? (state.startTime ?? Date.now()) : state.startTime
  let finished = 0
  let total = 0
  let hasRunning = false
  for (const s of Object.values(next)) {
    total += 1
    if (s.status === 'done' || s.status === 'failed') finished += 1
    if (s.status === 'running') hasRunning = true
  }
  const wasRunning = state.phase === 'running'
  const phase = finished === total && total > 0 ? 'done' : hasRunning ? 'running' : state.phase
  const shouldResort = (!wasRunning && phase === 'running') || phase === 'done'
  const sortSnapshot = shouldResort ? sortByStatus(Object.keys(next), next) : state.sortSnapshot
  const bellPending = wasRunning && phase === 'done' ? true : phase === 'running' ? false : state.bellPending
  const focused =
    shouldResort && !sortSnapshot.includes(state.focused) ? (sortSnapshot[0] ?? state.focused) : state.focused
  return { ...state, bellPending, focused, phase, projects: next, sortSnapshot, startTime }
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
  let runningCount = 0
  let doneCount = 0
  let failedCount = 0
  let steps = 0
  let maxE = 0
  let maxN = ''
  for (const [n, s] of Object.entries(projects)) {
    if (s.status === 'running') runningCount += 1
    if (s.status === 'done') doneCount += 1
    if (s.status === 'failed') {
      failedCount += 1
      steps += STEP_COUNT
    }
    steps += s.completedSteps.size
    if ((s.status === 'done' || s.status === 'failed') && s.elapsed > maxE) {
      maxE = s.elapsed
      maxN = n
    }
  }
  let eta: number | undefined
  if (runningCount > 0)
    if (history.length > 0) {
      let sum = 0
      for (const h of history) sum += h
      eta = Math.max(0, Math.round(sum / history.length - elapsed))
    } else if (lastElapsed > 0) eta = Math.max(0, lastElapsed - elapsed)
  return {
    completedStepCount: steps,
    done: doneCount,
    eta,
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
