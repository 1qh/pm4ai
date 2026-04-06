/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: signal handler */
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-empty-function, complexity */
import { Box, render, Text, useApp, useInput, useStdout } from 'ink'
import Spinner from 'ink-spinner'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
/* oxlint-disable complexity, no-empty-function, eslint-plugin-promise(param-names), eslint-plugin-react-perf(jsx-no-new-array-as-prop), eslint-plugin-react-perf(jsx-no-new-object-as-prop) */
import type { WatchEvent } from './watch-types.js'
import pkg from '../package.json' with { type: 'json' }
import { readCheckResult } from './check-cache.js'
import { discover } from './discover.js'
import { projectName } from './utils.js'
import { installCleanup, onEvent, startEmitter } from './watch-emitter.js'
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
const RESET_DELAY = 5000
const MAX_HISTORY = 8
const VERSION = pkg.version ?? '0.0.0'
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
  if (event.status === 'start')
    return {
      completedSteps: prev.completedSteps,
      elapsed: 0,
      startedAt: prev.startedAt ?? Date.now(),
      status: 'running',
      step: event.step
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
const safeReadCheck = (path: string) => {
  try {
    return readCheckResult(path)
  } catch {
    return null
  }
}
const mkIdleFn = (p: ProjectInfo): ProjectState => {
  const cached = safeReadCheck(p.path)
  if (!cached) return { completedSteps: new Set(), elapsed: 0, status: 'idle' }
  const label = `${cached.pass ? 'clean' : `${cached.violations} issues`} ${timeAgo(cached.at)}`
  return { cachedPass: cached.pass, completedSteps: new Set(), detail: label, elapsed: 0, status: 'idle' }
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
    const shouldUpdate = v.status === 'running' && v.startedAt
    const elapsed = shouldUpdate ? Math.floor((now - (v.startedAt ?? 0)) / 1000) : v.elapsed
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
  const prev = state.projects[event.project] ?? { completedSteps: new Set<string>(), elapsed: 0, status: 'idle' as const }
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
interface DerivedStats {
  completedStepCount: number
  done: number
  eta?: number
  failed: number
  running: number
  slowestElapsed: number
  slowestName: string
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
const createInitState = (projects: ProjectInfo[]): RunState => {
  const initial = Object.fromEntries(projects.map(p => [p.name, mkIdleFn(p)]))
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
const ProjectRow = ({
  focused,
  name,
  pad,
  state
}: {
  focused: boolean
  name: string
  pad: number
  state: ProjectState
}) => {
  const padded = name.padEnd(pad)
  const cursor = focused ? '›' : ' '
  const iconMap = { done: '✔', failed: '✘', idle: state.cachedPass === undefined ? '·' : '●', running: '' }
  const colorMap = {
    done: 'green' as const,
    failed: 'red' as const,
    idle: state.cachedPass === true ? ('green' as const) : state.cachedPass === false ? ('red' as const) : undefined,
    running: 'yellow' as const
  }
  const icon = iconMap[state.status]
  const color = colorMap[state.status]
  const isIdle = state.status === 'idle'
  const secs = state.elapsed > 0 ? state.elapsed : undefined
  const stepInfo =
    state.status === 'running'
      ? `${STEP_LABELS[state.step as keyof typeof STEP_LABELS] ?? '⚡ working'} ${progressDots(state.completedSteps, state.step)}`
      : (state.detail ?? '')
  return (
    <Box gap={1} paddingLeft={1}>
      <Text color={focused ? 'cyan' : undefined} dimColor={!focused}>
        {cursor}
      </Text>
      {state.status === 'running' ? (
        <Spinner type='dots' />
      ) : (
        <Text color={color} dimColor={isIdle ? !color : undefined}>
          {icon}
        </Text>
      )}
      <Text bold={focused || state.status === 'running'} dimColor={isIdle}>
        {padded}
      </Text>
      {stepInfo ? (
        <Text color={state.status === 'running' ? 'yellow' : color} dimColor={isIdle}>
          {stepInfo}
        </Text>
      ) : null}
      {secs === undefined ? null : <Text dimColor>{secs}s</Text>}
    </Box>
  )
}
ProjectRow.displayName = 'ProjectRow'
const DoneFooter = ({
  done,
  elapsed,
  failed,
  history,
  lastElapsed,
  slowestElapsed,
  slowestName
}: {
  done: number
  elapsed: number
  failed: number
  history: number[]
  lastElapsed: number
  slowestElapsed: number
  slowestName: string
}) => {
  const delta = lastElapsed > 0 ? elapsed - lastElapsed : 0
  const deltaLabel = delta > 0 ? `+${delta}s` : delta < 0 ? `${delta}s` : ''
  const deltaColor = delta > 0 ? 'red' : delta < 0 ? 'green' : undefined
  return (
    <Box flexDirection='column' paddingLeft={1}>
      {failed > 0 ? (
        <Box gap={1}>
          <Text color='red'>
            ✘ {failed} failed · {done} passed · {formatTime(elapsed)}
          </Text>
          <Text dimColor>press enter to dismiss</Text>
        </Box>
      ) : (
        <Box gap={1}>
          <Text bold color='green'>
            ✔ all clean · {formatTime(elapsed)}
          </Text>
          {deltaLabel && deltaColor ? <Text color={deltaColor}>({deltaLabel})</Text> : null}
          {history.length > 1 ? <Text dimColor>{sparkline(history)}</Text> : null}
        </Box>
      )}
      {slowestName && slowestElapsed > 0 ? (
        <Text dimColor>
          slowest: {slowestName} ({slowestElapsed}s)
        </Text>
      ) : null}
      {failed > 0 ? null : <Text dimColor>resetting in {RESET_DELAY / 1000}s...</Text>}
    </Box>
  )
}
DoneFooter.displayName = 'DoneFooter'
const IdleFooter = ({
  lastElapsed,
  lastFailed,
  lastTime,
  toast
}: {
  lastElapsed: number
  lastFailed: number
  lastTime: string
  toast: string
}) => (
  <Box flexDirection='column' paddingLeft={1}>
    {toast ? <Text color='cyan'>{toast}</Text> : null}
    {lastTime ? (
      <Text dimColor>
        last run: {lastFailed > 0 ? `${lastFailed} failed` : 'all clean'} · {formatTime(lastElapsed)} · {lastTime}
      </Text>
    ) : null}
    <Text dimColor>
      <Text bold dimColor>
        ↑↓/jk
      </Text>{' '}
      select ·{' '}
      <Text bold dimColor>
        g/G
      </Text>{' '}
      top/end ·{' '}
      <Text bold dimColor>
        ↵
      </Text>{' '}
      fix one ·{' '}
      <Text bold dimColor>
        f
      </Text>{' '}
      fix all ·{' '}
      <Text bold dimColor>
        s
      </Text>{' '}
      status ·{' '}
      <Text bold dimColor>
        q
      </Text>{' '}
      quit
    </Text>
  </Box>
)
IdleFooter.displayName = 'IdleFooter'
const RunningFooter = ({
  barWidth,
  elapsed,
  eta,
  fraction,
  pct
}: {
  barWidth: number
  elapsed: number
  eta?: number
  fraction: number
  pct: number
}) => (
  <Box gap={1} paddingLeft={1}>
    <Text color='cyan'>{smoothBar(fraction, barWidth)}</Text>
    <Text color='yellow'>{pct}%</Text>
    {elapsed > 0 ? <Text dimColor>{formatTime(elapsed)}</Text> : null}
    {eta !== undefined && eta > 0 ? <Text dimColor>~{formatTime(eta)} left</Text> : null}
  </Box>
)
RunningFooter.displayName = 'RunningFooter'
const safeSpawn = (args: string[], cwd?: string): boolean => {
  try {
    const proc = spawn('bunx', args, { cwd, detached: true, stdio: 'ignore' })
    proc.on('error', () => {})
    proc.unref()
    return true
  } catch {
    return false
  }
}
interface KeyAction {
  guard?: () => boolean
  handler: () => void
  key?: 'return'
  match?: (input: string) => boolean
}
const WatchApp = ({ projects }: { projects: ProjectInfo[] }) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [cols, setCols] = useState(stdout?.columns ?? 80)
  useEffect(() => {
    const handler = () => setCols(stdout?.columns ?? 80)
    stdout?.on('resize', handler)
    return () => {
      stdout?.off('resize', handler)
    }
  }, [stdout])
  const barWidth = Math.min(Math.max(Math.floor(cols * 0.3), 12), 40)
  const pad = useMemo(() => Math.max(...projects.map(p => p.name.length)) + 2, [projects])
  const projectMap = useMemo(() => new Map(projects.map(p => [p.name, p])), [projects])
  const [state, dispatch] = useReducer(runReducer, projects, createInitState)
  const [toast, setToast] = useState('')
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sorted = useMemo(() => {
    if (state.sortSnapshot.length === 0) return projects
    const result: ProjectInfo[] = []
    for (const n of state.sortSnapshot) {
      const p = projectMap.get(n)
      if (p) result.push(p)
    }
    return result
  }, [state.sortSnapshot, projects, projectMap])
  const focusedIdx = useMemo(() => {
    const idx = sorted.findIndex(p => p.name === state.focused)
    return Math.max(idx, 0)
  }, [sorted, state.focused])
  const stats = useMemo(
    () =>
      deriveStats({
        elapsed: state.elapsed,
        history: state.history,
        lastElapsed: state.lastElapsed,
        projects: state.projects
      }),
    [state.projects, state.history, state.lastElapsed, state.elapsed]
  )
  const hasFails = state.phase === 'done' && stats.failed > 0
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(''), 2000)
  }, [])
  const focus = useCallback((name: string) => dispatch({ focused: name, type: 'focus' }), [])
  const keymap: KeyAction[] = useMemo(
    () => [
      {
        handler: () => {
          const p = sorted[Math.max(0, focusedIdx - 1)]
          if (p) focus(p.name)
        },
        match: (i: string) => i === 'k'
      },
      {
        handler: () => {
          const p = sorted[Math.min(sorted.length - 1, focusedIdx + 1)]
          if (p) focus(p.name)
        },
        match: (i: string) => i === 'j'
      },
      {
        handler: () => {
          if (sorted[0]) focus(sorted[0].name)
        },
        match: (i: string) => i === 'g'
      },
      {
        handler: () => {
          const last = sorted.at(-1)
          if (last) focus(last.name)
        },
        match: (i: string) => i === 'G'
      },
      { handler: () => exit(), match: (i: string) => i === 'q' },
      { guard: () => hasFails, handler: () => dispatch({ mkIdle: mkIdleFn, projects, type: 'reset' }), key: 'return' },
      {
        guard: () => !hasFails && stats.running === 0,
        handler: () => {
          const p = sorted[focusedIdx]
          if (p && existsSync(p.path))
            if (safeSpawn(['pm4ai', 'fix'], p.path)) showToast(`fixing ${p.name}...`)
            else showToast(`${p.name}: spawn failed`)
          else if (p) showToast(`${p.name}: ${p.path} not found`)
        },
        key: 'return'
      },
      {
        guard: () => !hasFails && stats.running === 0,
        handler: () => {
          if (safeSpawn(['pm4ai', 'fix', '--all'])) showToast('starting fix --all...')
          else showToast('spawn failed')
        },
        match: (i: string) => i === 'f'
      },
      {
        guard: () => !hasFails && stats.running === 0,
        handler: () => {
          if (safeSpawn(['pm4ai', 'status', '--all'])) showToast('starting status --all...')
          else showToast('spawn failed')
        },
        match: (i: string) => i === 's'
      }
    ],
    [sorted, focusedIdx, hasFails, stats.running, projects, exit, focus, showToast]
  )
  useInput((input, key) => {
    if (key.upArrow) {
      keymap[0]?.handler()
      return
    }
    if (key.downArrow) {
      keymap[1]?.handler()
      return
    }
    if (key.ctrl && input === 'c') {
      exit()
      return
    }
    if (hasFails && !key.return) return
    for (const action of keymap) {
      if (action.key === 'return' && key.return && (!action.guard || action.guard())) {
        action.handler()
        return
      }
      if (action.match?.(input) && (!action.guard || action.guard())) {
        action.handler()
        return
      }
    }
  })
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'tick' }), 1000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    const unsub = onEvent(event => dispatch({ event, type: 'event' }))
    return unsub
  }, [])
  useEffect(() => {
    if (state.bellPending) {
      stdout?.write('\u0007')
      dispatch({ type: 'bell-acked' })
    }
  }, [state.bellPending, stdout])
  useEffect(() => {
    if (state.phase !== 'done' || hasFails) return
    const timer = setTimeout(() => dispatch({ mkIdle: mkIdleFn, projects, type: 'reset' }), RESET_DELAY)
    return () => clearTimeout(timer)
  }, [state.phase, hasFails, projects])
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    },
    []
  )
  const totalSteps = projects.length * STEP_COUNT
  const fraction = totalSteps > 0 ? stats.completedStepCount / totalSteps : 0
  const pct = Math.round(fraction * 100)
  const sepWidth = Math.max(0, cols - 4)
  return (
    <Box flexDirection='column'>
      <Box gap={1} marginBottom={1} paddingLeft={1}>
        <Text bold color='magenta'>
          ⚡ pm4ai
        </Text>
        <Text dimColor>
          v{VERSION} · {projects.length} projects
        </Text>
        {state.runCount > 0 ? <Text dimColor>· run #{state.runCount}</Text> : null}
        {state.history.length > 1 ? <Text dimColor>{sparkline(state.history)}</Text> : null}
      </Box>
      {sorted.map(p => (
        <ProjectRow
          focused={p.name === state.focused}
          key={p.name}
          name={p.name}
          pad={pad}
          state={state.projects[p.name] ?? { completedSteps: new Set<string>(), elapsed: 0, status: 'idle' as const }}
        />
      ))}
      <Box marginTop={1} paddingLeft={1}>
        <Text dimColor>{'─'.repeat(sepWidth)}</Text>
      </Box>
      <Box flexDirection='column' marginTop={1}>
        {state.phase === 'running' ? (
          <RunningFooter barWidth={barWidth} elapsed={state.elapsed} eta={stats.eta} fraction={fraction} pct={pct} />
        ) : state.phase === 'done' ? (
          <DoneFooter
            done={stats.done}
            elapsed={state.elapsed}
            failed={stats.failed}
            history={state.history}
            lastElapsed={state.lastElapsed}
            slowestElapsed={stats.slowestElapsed}
            slowestName={stats.slowestName}
          />
        ) : (
          <IdleFooter
            lastElapsed={state.lastElapsed}
            lastFailed={state.lastFailed}
            lastTime={state.lastTime}
            toast={toast}
          />
        )}
      </Box>
    </Box>
  )
}
WatchApp.displayName = 'WatchApp'
const watchJson = async (): Promise<void> => {
  const ac = new AbortController()
  process.on('SIGINT', () => ac.abort())
  process.on('SIGTERM', () => ac.abort())
  onEvent(event => {
    if (!ac.signal.aborted) process.stdout.write(`${JSON.stringify(event)}\n`)
  })
  await once(ac.signal, 'abort').catch(() => {})
}
const watch = async (json = false) => {
  await startEmitter()
  installCleanup()
  if (json) return watchJson()
  const { consumers, self, cnsync } = await discover()
  const allProjects = cnsync ? [self, cnsync, ...consumers] : [self, ...consumers]
  const projects = allProjects.map(p => ({ name: p.name || projectName(p.path), path: p.path }))
  const app = render(<WatchApp projects={projects} />)
  await app.waitUntilExit()
}
export {
  createInitState,
  deriveStats,
  formatTime,
  mkIdleFn,
  nextProjectState,
  runReducer,
  smoothBar,
  sparkline,
  tickProjects
}
export { watch, WatchApp }
