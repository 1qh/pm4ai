/** biome-ignore-all lint/style/noNonNullAssertion: bar char access */
/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unnecessary-condition, react-hooks/purity, complexity, react/display-name, @eslint-react/no-missing-component-display-name */
import { Box, render, Text, useApp, useInput, useStdout } from 'ink'
import Spinner from 'ink-spinner'
import { spawn } from 'node:child_process'
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
/* oxlint-disable complexity, eslint-plugin-react(display-name), eslint-plugin-react-perf(jsx-no-new-array-as-prop), eslint-plugin-react-perf(jsx-no-new-object-as-prop), typescript-eslint(no-non-null-assertion) */
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
  completedSteps: string[]
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
  startTime?: number
}
const STEPS = ['sync', 'audit', 'maintain', 'check']
const STEP_COUNT = STEPS.length
const STEP_LABELS: Record<string, string> = {
  audit: '🔍 auditing',
  check: '🧪 checking',
  maintain: '🔧 maintaining',
  sync: '📦 syncing'
}
const STATUS_ORDER: Record<string, number> = { done: 1, failed: 2, idle: 3, running: 0 }
const BAR_CHARS = ' ▏▎▍▌▋▊▉█'
const SPARK_CHARS = '▁▂▃▄▅▆▇█'
const RESET_DELAY = 5000
const MAX_HISTORY = 8
const smoothBar = (fraction: number, width: number): string => {
  const total = fraction * width
  const full = Math.floor(total)
  const partial = total - full
  const partialIdx = Math.round(partial * (BAR_CHARS.length - 1))
  const partialChar = BAR_CHARS[partialIdx] ?? ''
  const empty = width - full - (partialChar.trim() ? 1 : 0)
  return `${BAR_CHARS.at(-1)!.repeat(full)}${partialChar}${' '.repeat(Math.max(0, empty))}`
}
const sparkline = (values: number[]): string => {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  if (max === 0) return SPARK_CHARS[0]!.repeat(values.length)
  return values.map(v => SPARK_CHARS[Math.round((v / max) * (SPARK_CHARS.length - 1))] ?? SPARK_CHARS[0]).join('')
}
const progressDots = (completed: string[], current?: string): string => {
  const parts: string[] = []
  for (const s of STEPS)
    if (completed.includes(s)) parts.push('●')
    else if (s === current) parts.push('◌')
    else parts.push('·')
  return parts.join('')
}
const formatTime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m${s > 0 ? `${s}s` : ''}`
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
      : { completedSteps: STEPS, detail: event.detail ?? 'clean', elapsed: projectElapsed, status: 'done' }
  }
  if (event.status === 'start')
    return {
      completedSteps: prev.completedSteps,
      startedAt: prev.startedAt ?? Date.now(),
      status: 'running',
      step: event.step
    }
  const completed = event.status === 'ok' ? [...prev.completedSteps, event.step] : prev.completedSteps
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
  if (!cached) return { completedSteps: [], status: 'idle' }
  const label = `${cached.pass ? 'clean' : `${cached.violations} issues`} ${timeAgo(cached.at)}`
  return { cachedPass: cached.pass, completedSteps: [], detail: label, status: 'idle' }
}
const runReducer = (state: RunState, action: RunAction): RunState => {
  if (action.type === 'tick') {
    if (!state.startTime) return state
    return { ...state, elapsed: Math.floor((Date.now() - state.startTime) / 1000) }
  }
  if (action.type === 'reset')
    return {
      ...state,
      elapsed: 0,
      history: [...state.history, state.elapsed].slice(-MAX_HISTORY),
      lastDone: Object.values(state.projects).filter(s => s.status === 'done').length,
      lastElapsed: state.elapsed,
      lastFailed: Object.values(state.projects).filter(s => s.status === 'failed').length,
      lastTime: new Date().toLocaleTimeString(),
      phase: 'idle',
      projects: Object.fromEntries(action.projects.map(p => [p.name, action.mkIdle(p)])),
      runCount: state.runCount + 1,
      startTime: undefined
    }
  const { event } = action
  const prev = state.projects[event.project] ?? { completedSteps: [], status: 'idle' }
  const next = { ...state.projects, [event.project]: nextProjectState(prev, event) }
  const startTime = event.status === 'start' && event.step !== 'done' ? (state.startTime ?? Date.now()) : state.startTime
  const vals = Object.values(next)
  const finished = vals.filter(s => s.status === 'done' || s.status === 'failed').length
  const total = Object.keys(next).length
  const phase = finished === total && total > 0 ? 'done' : vals.some(s => s.status === 'running') ? 'running' : state.phase
  return { ...state, phase, projects: next, startTime }
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
      idle: state.cachedPass === true ? 'green' : state.cachedPass === false ? 'red' : undefined,
      running: 'yellow' as const
    }
    const icon = iconMap[state.status]
    const color = colorMap[state.status]
    const isIdle = state.status === 'idle'
    const secs = state.status === 'running' && state.startedAt ? Math.floor((now - state.startedAt) / 1000) : state.elapsed
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
        {secs && secs > 0 ? <Text dimColor>{secs}s</Text> : null}
      </Box>
    )
  }
)
const DoneFooter = memo(
  ({
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
            <Text dimColor>press any key to dismiss</Text>
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
      </Box>
    )
  }
)
const WatchApp = ({ projects }: { projects: ProjectInfo[] }) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80
  const barWidth = Math.min(Math.max(Math.floor(cols * 0.3), 12), 40)
  const pad = useMemo(() => Math.max(...projects.map(p => p.name.length)) + 2, [projects])
  const initState = useCallback(
    (): RunState => ({
      elapsed: 0,
      history: [],
      lastDone: 0,
      lastElapsed: 0,
      lastFailed: 0,
      lastTime: '',
      phase: 'idle',
      projects: Object.fromEntries(projects.map(p => [p.name, mkIdleFn(p)])),
      runCount: 0,
      startTime: undefined
    }),
    [projects]
  )
  const [state, dispatch] = useReducer(runReducer, undefined, initState)
  const [focusedName, setFocusedName] = useState(projects[0]?.name ?? '')
  const [toast, setToast] = useState('')
  const bellFiredRef = useRef(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sorted = useMemo(
    () =>
      [...projects].toSorted((a, b) => {
        const sa = state.projects[a.name]?.status ?? 'idle'
        const sb = state.projects[b.name]?.status ?? 'idle'
        return (STATUS_ORDER[sa] ?? 9) - (STATUS_ORDER[sb] ?? 9)
      }),
    [projects, state.projects]
  )
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
  const vals = Object.values(state.projects)
  const running = vals.filter(s => s.status === 'running').length
  const done = vals.filter(s => s.status === 'done').length
  const failed = vals.filter(s => s.status === 'failed').length
  const hasFails = state.phase === 'done' && failed > 0
  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(''), 2000)
  }
  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      const idx = Math.max(0, focusedIdx - 1)
      setFocusedName(sorted[idx]?.name ?? focusedName)
    }
    if (key.downArrow || input === 'j') {
      const idx = Math.min(sorted.length - 1, focusedIdx + 1)
      setFocusedName(sorted[idx]?.name ?? focusedName)
    }
    if (input === 'g') setFocusedName(sorted[0]?.name ?? focusedName)
    if (input === 'G') setFocusedName(sorted.at(-1)?.name ?? focusedName)
    if (hasFails) {
      dispatch({ mkIdle: mkIdleFn, projects, type: 'reset' })
      return
    }
    if (key.return && running === 0 && sorted[focusedIdx]) {
      const p = sorted[focusedIdx]
      spawn('bunx', ['pm4ai', 'fix'], { cwd: p.path, detached: true, stdio: 'ignore' }).unref()
      showToast(`fixing ${p.name}...`)
    }
    if (input === 'f' && running === 0) {
      spawn('bunx', ['pm4ai', 'fix', '--all'], { detached: true, stdio: 'ignore' }).unref()
      showToast('starting fix --all...')
    }
    if (input === 's' && running === 0) {
      spawn('bunx', ['pm4ai', 'status', '--all'], { detached: true, stdio: 'ignore' }).unref()
      showToast('starting status --all...')
    }
    if (input === 'q' || (key.ctrl && input === 'c')) exit()
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
  const completedSteps = vals.reduce((sum, s) => sum + s.completedSteps.length, 0)
  const fraction = totalSteps > 0 ? completedSteps / totalSteps : 0
  const pct = Math.round(fraction * 100)
  const etaFromLast = state.lastElapsed > 0 && running > 0 ? Math.max(0, state.lastElapsed - state.elapsed) : undefined
  const sepWidth = Math.min(cols - 2, 60)
  const now = state.phase === 'running' ? Date.now() : 0
  return (
    <Box flexDirection='column'>
      <Box gap={1} marginBottom={1} paddingLeft={1}>
        <Text bold color='magenta'>
          ⚡ pm4ai
        </Text>
        <Text dimColor>
          v{pkg.version} · {projects.length} projects
        </Text>
        {state.runCount > 0 ? <Text dimColor>· run #{state.runCount + 1}</Text> : null}
        {state.history.length > 1 ? <Text dimColor>{sparkline(state.history)}</Text> : null}
      </Box>
      {sorted.map(p => (
        <ProjectRow
          focused={p.name === focusedName}
          key={p.path}
          name={p.name}
          now={now}
          pad={pad}
          state={state.projects[p.name] ?? { completedSteps: [], status: 'idle' }}
        />
      ))}
      <Box marginTop={1} paddingLeft={1}>
        <Text dimColor>{'─'.repeat(sepWidth)}</Text>
      </Box>
      <Box flexDirection='column' marginTop={1}>
        {state.phase === 'running' ? (
          <Box gap={1} paddingLeft={1}>
            <Text color='cyan'>{smoothBar(fraction, barWidth)}</Text>
            <Text color='yellow'>{pct}%</Text>
            {state.elapsed > 0 ? <Text dimColor>{formatTime(state.elapsed)}</Text> : null}
            {etaFromLast ? <Text dimColor>~{formatTime(etaFromLast)} left</Text> : null}
          </Box>
        ) : state.phase === 'done' ? (
          <DoneFooter
            done={done}
            elapsed={state.elapsed}
            failed={failed}
            history={state.history}
            lastElapsed={state.lastElapsed}
            slowestElapsed={slowestElapsed}
            slowestName={slowestName}
          />
        ) : (
          <Box flexDirection='column' paddingLeft={1}>
            {toast ? <Text color='cyan'>{toast}</Text> : null}
            {state.lastTime ? (
              <Text dimColor>
                last run: {state.lastFailed > 0 ? `${state.lastFailed} failed` : 'all clean'} ·{' '}
                {formatTime(state.lastElapsed)} · {state.lastTime}
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
        )}
      </Box>
    </Box>
  )
}
const watchJson = async (): Promise<void> => {
  onEvent(event => {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  })
  await new Promise<void>(() => {
    /* Runs forever */
  })
}
const watch = async (json = false) => {
  await startEmitter()
  installCleanup()
  if (json) return watchJson()
  const { consumers, self, cnsync } = await discover()
  const allProjects = [self, cnsync, ...consumers]
  const projects = allProjects.map(p => ({ name: p.name || projectName(p.path), path: p.path }))
  const app = render(<WatchApp projects={projects} />)
  await app.waitUntilExit()
}
export { watch, WatchApp }
