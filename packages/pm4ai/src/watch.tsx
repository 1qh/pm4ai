/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: signal handler */
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-empty-function */
import { Box, render, Text, useApp, useInput, useStdout } from 'ink'
import Spinner from 'ink-spinner'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
/* oxlint-disable complexity, no-empty-function, eslint-plugin-promise(param-names), eslint-plugin-react-perf(jsx-no-new-array-as-prop), eslint-plugin-react-perf(jsx-no-new-object-as-prop) */
import type { ProjectInfo, ProjectState } from './watch-state.js'
import pkg from '../package.json' with { type: 'json' }
import { readCheckResult } from './check-cache.js'
import { discover } from './discover.js'
import { projectName } from './utils.js'
import { installCleanup, onEvent, startEmitter } from './watch-emitter.js'
import {
  createInitState,
  deriveStats,
  formatTime,
  IDLE_FALLBACK,
  progressDots,
  runReducer,
  smoothBar,
  sparkline,
  STEP_COUNT,
  STEP_LABELS,
  timeAgo
} from './watch-state.js'
const VERSION = pkg.version ?? '0.0.0'
const RESET_DELAY = 5000
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
  arrow?: 'down' | 'up'
  guard?: () => boolean
  handler: () => void
  key?: 'return'
  match?: (input: string) => boolean
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
  const [state, dispatch] = useReducer(runReducer, projects, (p: ProjectInfo[]) => createInitState(p, mkIdleFn))
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
        arrow: 'up' as const,
        handler: () => {
          const p = sorted[Math.max(0, focusedIdx - 1)]
          if (p) focus(p.name)
        },
        match: (i: string) => i === 'k'
      },
      {
        arrow: 'down' as const,
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
    if (key.ctrl && input === 'c') {
      exit()
      return
    }
    for (const action of keymap) {
      const arrowMatch = (action.arrow === 'up' && key.upArrow) || (action.arrow === 'down' && key.downArrow)
      const keyMatch = action.key === 'return' && key.return
      const inputMatch = action.match?.(input)
      if ((arrowMatch || keyMatch || inputMatch) && (!action.guard || action.guard())) {
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
          state={state.projects[p.name] ?? IDLE_FALLBACK}
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
export { mkIdleFn, watch, WatchApp }
