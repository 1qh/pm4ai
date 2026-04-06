/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: abort handler */
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-empty-function, complexity, react-hooks/purity */
import { Box, render, Text, useApp, useInput, useStdout } from 'ink'
import Spinner from 'ink-spinner'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
  elapsed?: number
  startedAt?: number
  status: 'done' | 'failed' | 'idle' | 'running'
  step?: string
}
type RunAction =
  | { event: WatchEvent; type: 'event' }
  | { mkIdle: (p: ProjectInfo) => ProjectState; projects: ProjectInfo[]; type: 'reset' }
  | { type: 'tick' }
interface RunState {
  elapsed: number
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
const STEP_LABELS: Record<string, string> = {
  audit: '🔍 auditing',
  check: '🧪 checking',
  maintain: '🔧 maintaining',
  sync: '📦 syncing'
}
const STATUS_ORDER = { done: 1, failed: 2, idle: 3, running: 0 } as const
const BAR_CHARS = ' ▏▎▍▌▋▊▉█'
const BAR_FULL = BAR_CHARS.at(-1) ?? '█'
const SPARK_CHARS = '▁▂▃▄▅▆▇█'
const SPARK_ZERO = SPARK_CHARS[0] ?? '▁'
const RESET_DELAY = 5000
const MAX_HISTORY = 8
const smoothBar = (fraction: number, width: number): string => {
  const clamped = Math.min(1, Math.max(0, fraction))
  const total = clamped * width
  const full = Math.floor(total)
  const partial = total - full
  const partialIdx = Math.round(partial * (BAR_CHARS.length - 1))
  const partialChar = full < width ? (BAR_CHARS[partialIdx] ?? '') : ''
  const filled = full + (partialChar.trim() ? 1 : 0)
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
    const projectElapsed = prev.startedAt ? Math.floor((Date.now() - prev.startedAt) / 1000) : undefined
    return event.status === 'fail'
      ? { completedSteps: prev.completedSteps, detail: event.detail, elapsed: projectElapsed, status: 'failed' }
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
      startedAt: prev.startedAt ?? Date.now(),
      status: 'running',
      step: event.step
    }
  if (event.status === 'fail')
    return {
      completedSteps: prev.completedSteps,
      detail: event.detail,
      startedAt: prev.startedAt,
      status: 'running',
      step: event.step
    }
  const completed = new Set([...prev.completedSteps, event.step])
  return {
    completedSteps: completed,
    detail: event.detail,
    startedAt: prev.startedAt,
    status: 'running',
    step: event.step
  }
}
const mkIdleFn = (p: ProjectInfo): ProjectState => {
  const cached = readCheckResult(p.path)
  if (!cached) return { completedSteps: new Set(), status: 'idle' }
  const label = `${cached.pass ? 'clean' : `${cached.violations} issues`} ${timeAgo(cached.at)}`
  return { cachedPass: cached.pass, completedSteps: new Set(), detail: label, status: 'idle' }
}
const sortByStatus = (names: string[], projects: Record<string, ProjectState>): string[] =>
  [...names].toSorted((a, b) => {
    const sa = projects[a]?.status ?? 'idle'
    const sb = projects[b]?.status ?? 'idle'
    return (STATUS_ORDER[sa] ?? 9) - (STATUS_ORDER[sb] ?? 9)
  })
const runReducer = (state: RunState, action: RunAction): RunState => {
  if (action.type === 'tick') {
    if (!state.startTime) return state
    return { ...state, elapsed: Math.floor((Date.now() - state.startTime) / 1000) }
  }
  if (action.type === 'reset') {
    const newProjects = Object.fromEntries(action.projects.map(p => [p.name, action.mkIdle(p)]))
    return {
      ...state,
      elapsed: 0,
      history: state.elapsed > 0 ? [...state.history, state.elapsed].slice(-MAX_HISTORY) : state.history,
      lastDone: Object.values(state.projects).filter(s => s.status === 'done').length,
      lastElapsed: state.elapsed,
      lastFailed: Object.values(state.projects).filter(s => s.status === 'failed').length,
      lastTime: new Date().toLocaleTimeString(),
      phase: 'idle',
      projects: newProjects,
      runCount: state.runCount + 1,
      sortSnapshot: sortByStatus(Object.keys(newProjects), newProjects),
      startTime: undefined
    }
  }
  const { event } = action
  const prev = state.projects[event.project] ?? { completedSteps: new Set<string>(), status: 'idle' as const }
  const nextProj = nextProjectState(prev, event)
  const next = { ...state.projects, [event.project]: nextProj }
  const startTime = event.status === 'start' && event.step !== 'done' ? (state.startTime ?? Date.now()) : state.startTime
  const vals = Object.values(next)
  const finished = vals.filter(s => s.status === 'done' || s.status === 'failed').length
  const total = Object.keys(next).length
  const wasRunning = state.phase === 'running'
  const phase = finished === total && total > 0 ? 'done' : vals.some(s => s.status === 'running') ? 'running' : state.phase
  const shouldResort = (!wasRunning && phase === 'running') || phase === 'done'
  const sortSnapshot = shouldResort ? sortByStatus(Object.keys(next), next) : state.sortSnapshot
  return { ...state, phase, projects: next, sortSnapshot, startTime }
}
const ProjectRow = memo(
  ({
    focused,
    name,
    now,
    pad,
    state
  }: {
    focused: boolean
    name: string
    now: number
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
    const rawSecs =
      state.status === 'running' && state.startedAt ? Math.floor((now - state.startedAt) / 1000) : state.elapsed
    const secs = rawSecs !== undefined && rawSecs > 0 ? rawSecs : undefined
    const stepInfo =
      state.status === 'running'
        ? `${STEP_LABELS[state.step ?? ''] ?? '⚡ working'} ${progressDots(state.completedSteps, state.step)}`
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
)
ProjectRow.displayName = 'ProjectRow'
const DoneFooter = memo(
  ({
    done,
    elapsed,
    failed,
    hasFails,
    history,
    lastElapsed,
    slowestElapsed,
    slowestName
  }: {
    done: number
    elapsed: number
    failed: number
    hasFails: boolean
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
        {hasFails ? null : <Text dimColor>resetting in {RESET_DELAY / 1000}s...</Text>}
      </Box>
    )
  }
)
DoneFooter.displayName = 'DoneFooter'
const IdleFooter = ({
  lastElapsed,
  lastFailed,
  lastTime,
  running,
  toast
}: {
  lastElapsed: number
  lastFailed: number
  lastTime: string
  running: number
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
        ↵
      </Text>{' '}
      fix one ·{' '}
      {running > 0 ? (
        <Text dimColor>running...</Text>
      ) : (
        <>
          <Text bold dimColor>
            f
          </Text>{' '}
          fix all ·{' '}
          <Text bold dimColor>
            s
          </Text>{' '}
          status ·{' '}
        </>
      )}
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
  const initState = (): RunState => {
    const initial = Object.fromEntries(projects.map(p => [p.name, mkIdleFn(p)]))
    return {
      elapsed: 0,
      history: [],
      lastDone: 0,
      lastElapsed: 0,
      lastFailed: 0,
      lastTime: '',
      phase: 'idle',
      projects: initial,
      runCount: 0,
      sortSnapshot: sortByStatus(Object.keys(initial), initial),
      startTime: undefined
    }
  }
  const [state, dispatch] = useReducer(runReducer, undefined, initState)
  const [focusedName, setFocusedName] = useState(projects[0]?.name ?? '')
  const [toast, setToast] = useState('')
  const bellFiredRef = useRef(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sorted =
    state.sortSnapshot.length > 0
      ? (state.sortSnapshot.map(n => projects.find(p => p.name === n)).filter(Boolean) as ProjectInfo[])
      : projects
  const focusedIdx = sorted.findIndex(p => p.name === focusedName)
  const { slowestElapsed, slowestName } = useMemo(() => {
    let maxE = 0
    let maxN = ''
    for (const [n, s] of Object.entries(state.projects))
      if ((s.status === 'done' || s.status === 'failed') && (s.elapsed ?? 0) > maxE) {
        maxE = s.elapsed ?? 0
        maxN = n
      }
    return { slowestElapsed: maxE, slowestName: maxN }
  }, [state.projects])
  const running = useMemo(() => {
    let count = 0
    for (const s of Object.values(state.projects)) if (s.status === 'running') count += 1
    return count
  }, [state.projects])
  const done = useMemo(() => {
    let count = 0
    for (const s of Object.values(state.projects)) if (s.status === 'done') count += 1
    return count
  }, [state.projects])
  const failed = useMemo(() => {
    let count = 0
    for (const s of Object.values(state.projects)) if (s.status === 'failed') count += 1
    return count
  }, [state.projects])
  const hasFails = state.phase === 'done' && failed > 0
  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(''), 2000)
  }
  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      const idx = Math.max(0, focusedIdx - 1)
      if (sorted[idx]) setFocusedName(sorted[idx].name)
      return
    }
    if (key.downArrow || input === 'j') {
      const idx = Math.min(sorted.length - 1, focusedIdx + 1)
      if (sorted[idx]) setFocusedName(sorted[idx].name)
      return
    }
    if (input === 'g') {
      if (sorted[0]) setFocusedName(sorted[0].name)
      return
    }
    if (input === 'G') {
      const last = sorted.at(-1)
      if (last) setFocusedName(last.name)
      return
    }
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit()
      return
    }
    if (hasFails && key.return) {
      dispatch({ mkIdle: mkIdleFn, projects, type: 'reset' })
      return
    }
    if (hasFails) return
    if (key.return && running === 0) {
      const p = sorted[focusedIdx]
      if (p && existsSync(p.path)) {
        spawn('bunx', ['pm4ai', 'fix'], { cwd: p.path, detached: true, stdio: 'ignore' }).unref()
        showToast(`fixing ${p.name}...`)
      } else if (p) showToast(`${p.name}: path not found`)
      return
    }
    if (input === 'f' && running === 0) {
      spawn('bunx', ['pm4ai', 'fix', '--all'], { detached: true, stdio: 'ignore' }).unref()
      showToast('starting fix --all...')
      return
    }
    if (input === 's' && running === 0) {
      spawn('bunx', ['pm4ai', 'status', '--all'], { detached: true, stdio: 'ignore' }).unref()
      showToast('starting status --all...')
    }
  })
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'tick' }), 1000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    const unsub = onEvent(event => {
      bellFiredRef.current = false
      dispatch({ event, type: 'event' })
    })
    return unsub
  }, [])
  useEffect(() => {
    if (state.phase === 'done' && !bellFiredRef.current) {
      bellFiredRef.current = true
      stdout?.write('\u0007')
    }
  }, [state.phase, stdout])
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
  let completedSteps = 0
  for (const s of Object.values(state.projects)) completedSteps += s.completedSteps.size
  const fraction = totalSteps > 0 ? completedSteps / totalSteps : 0
  const pct = Math.round(fraction * 100)
  const eta =
    state.history.length > 0 && running > 0
      ? Math.max(0, Math.round(state.history.reduce((a, b) => a + b, 0) / state.history.length - state.elapsed))
      : state.lastElapsed > 0 && running > 0
        ? Math.max(0, state.lastElapsed - state.elapsed)
        : undefined
  const now = Date.now()
  const sepWidth = Math.min(cols - 4, pad + 40)
  return (
    <Box flexDirection='column'>
      <Box gap={1} marginBottom={1} paddingLeft={1}>
        <Text bold color='magenta'>
          ⚡ pm4ai
        </Text>
        <Text dimColor>
          v{pkg.version} · {projects.length} projects
        </Text>
        {state.runCount > 0 ? <Text dimColor>· run #{state.runCount}</Text> : null}
        {state.history.length > 1 ? <Text dimColor>{sparkline(state.history)}</Text> : null}
      </Box>
      {sorted.map(p => (
        <ProjectRow
          focused={p.name === focusedName}
          key={p.name}
          name={p.name}
          now={now}
          pad={pad}
          state={state.projects[p.name] ?? { completedSteps: new Set<string>(), status: 'idle' as const }}
        />
      ))}
      <Box marginTop={1} paddingLeft={1}>
        <Text dimColor>{'─'.repeat(Math.max(0, sepWidth))}</Text>
      </Box>
      <Box flexDirection='column' marginTop={1}>
        {state.phase === 'running' ? (
          <RunningFooter barWidth={barWidth} elapsed={state.elapsed} eta={eta} fraction={fraction} pct={pct} />
        ) : state.phase === 'done' ? (
          <DoneFooter
            done={done}
            elapsed={state.elapsed}
            failed={failed}
            hasFails={hasFails}
            history={state.history}
            lastElapsed={state.lastElapsed}
            slowestElapsed={slowestElapsed}
            slowestName={slowestName}
          />
        ) : (
          <IdleFooter
            lastElapsed={state.lastElapsed}
            lastFailed={state.lastFailed}
            lastTime={state.lastTime}
            running={running}
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
  await new Promise<void>((_, reject) => {
    ac.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }).catch(() => {})
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
export { watch, WatchApp }
