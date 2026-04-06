/** biome-ignore-all lint/style/noNonNullAssertion: bar char access */
/* eslint-disable react-hooks/purity, @typescript-eslint/no-non-null-assertion */
/* oxlint-disable complexity, eslint-plugin-react-perf(jsx-no-new-array-as-prop), eslint-plugin-react-perf(jsx-no-new-object-as-prop), eslint-plugin-unicorn(no-process-exit), typescript-eslint(no-non-null-assertion) */
import { Box, render, Text, useInput } from 'ink'
import Spinner from 'ink-spinner'
import { spawn } from 'node:child_process'
import { useEffect, useRef, useState } from 'react'
import pkg from '../package.json' with { type: 'json' }
import { readCheckResult } from './check-cache.js'
import { discover } from './discover.js'
import { projectName } from './utils.js'
import { installCleanup, onEvent, startEmitter } from './watch-emitter.js'
interface LastRun {
  done: number
  elapsed: number
  failed: number
  time: string
}
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
const BAR_WIDTH = 24
const smoothBar = (fraction: number): string => {
  const total = fraction * BAR_WIDTH
  const full = Math.floor(total)
  const partial = total - full
  const partialIdx = Math.round(partial * (BAR_CHARS.length - 1))
  const partialChar = BAR_CHARS[partialIdx] ?? ''
  const empty = BAR_WIDTH - full - (partialChar.trim() ? 1 : 0)
  return `${BAR_CHARS.at(-1)!.repeat(full)}${partialChar}${' '.repeat(Math.max(0, empty))}`
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
const bell = () => process.stdout.write('\u0007')
const ProjectRow = ({ name, now, state }: { name: string; now: number; state: ProjectState }) => {
  const padded = name.padEnd(24)
  if (state.status === 'idle') {
    const label = state.detail ?? ''
    const color = state.cachedPass === true ? 'green' : state.cachedPass === false ? 'red' : undefined
    return (
      <Box gap={1}>
        {color ? <Text color={color}> ●</Text> : <Text dimColor> ·</Text>}
        <Text dimColor>{padded}</Text>
        {label ? <Text dimColor>{label}</Text> : null}
      </Box>
    )
  }
  if (state.status === 'running') {
    const label = STEP_LABELS[state.step ?? ''] ?? '⚡ working'
    const dots = progressDots(state.completedSteps, state.step)
    const secs = state.startedAt ? Math.floor((now - state.startedAt) / 1000) : 0
    return (
      <Box gap={1}>
        <Text color='yellow'> </Text>
        <Spinner type='dots' />
        <Text bold>{padded}</Text>
        <Text color='yellow'>{label}</Text>
        <Text dimColor>{dots}</Text>
        {secs > 0 ? <Text dimColor>{secs}s</Text> : null}
      </Box>
    )
  }
  if (state.status === 'failed') {
    const secs = state.elapsed ? `${state.elapsed}s` : ''
    return (
      <Box gap={1}>
        <Text color='red'> ✘</Text>
        <Text>{padded}</Text>
        <Text color='red'>{state.detail ?? 'failed'}</Text>
        {secs ? <Text dimColor>{secs}</Text> : null}
      </Box>
    )
  }
  const secs = state.elapsed ? `${state.elapsed}s` : ''
  return (
    <Box gap={1}>
      <Text color='green'> ✔</Text>
      <Text>{padded}</Text>
      <Text color='green'>{state.detail ?? 'done'}</Text>
      {secs ? <Text dimColor>{secs}</Text> : null}
    </Box>
  )
}
const mkIdle = (p: ProjectInfo): ProjectState => {
  const cached = readCheckResult(p.path)
  if (!cached) return { completedSteps: [], status: 'idle' }
  const label = `${cached.pass ? 'clean' : `${cached.violations} issues`} ${timeAgo(cached.at)}`
  return { cachedPass: cached.pass, completedSteps: [], detail: label, status: 'idle' }
}
const RESET_DELAY = 5000
const WatchApp = ({ projects }: { projects: ProjectInfo[] }) => {
  const [states, setStates] = useState<Record<string, ProjectState>>(() => {
    const init: Record<string, ProjectState> = {}
    for (const p of projects) init[p.name] = mkIdle(p)
    return init
  })
  const [elapsed, setElapsed] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [startTime, setStartTime] = useState<number | undefined>()
  const [lastRun, setLastRun] = useState<LastRun | undefined>()
  const [runCount, setRunCount] = useState(0)
  const [toast, setToast] = useState('')
  const bellFiredRef = useRef(false)
  const vals = Object.values(states)
  const running = vals.filter(s => s.status === 'running').length
  const done = vals.filter(s => s.status === 'done').length
  const failed = vals.filter(s => s.status === 'failed').length
  const finished = done + failed
  const total = projects.length
  const allDone = finished === total && total > 0
  useInput((input, key) => {
    if (input === 'f' && running === 0) {
      spawn('bunx', ['pm4ai', 'fix', '--all'], { detached: true, stdio: 'ignore' }).unref()
      setToast('starting fix --all...')
      setTimeout(() => setToast(''), 2000)
    }
    if (input === 's' && running === 0) {
      spawn('bunx', ['pm4ai', 'status', '--all'], { detached: true, stdio: 'ignore' }).unref()
      setToast('starting status --all...')
      setTimeout(() => setToast(''), 2000)
    }
    if (input === 'q' || (key.ctrl && input === 'c')) process.exit(0)
  })
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
      if (startTime) setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 100)
    return () => clearInterval(interval)
  }, [startTime])
  useEffect(() => {
    const unsub = onEvent(event => {
      bellFiredRef.current = false
      setStates(prev => {
        const next = { ...prev }
        const prevState = prev[event.project] ?? { completedSteps: [], status: 'idle' }
        if (event.step === 'done') {
          const projectElapsed = prevState.startedAt ? Math.floor((Date.now() - prevState.startedAt) / 1000) : undefined
          next[event.project] =
            event.status === 'fail'
              ? {
                  completedSteps: prevState.completedSteps,
                  detail: event.detail,
                  elapsed: projectElapsed,
                  status: 'failed'
                }
              : { completedSteps: STEPS, detail: event.detail ?? 'clean', elapsed: projectElapsed, status: 'done' }
        } else if (event.status === 'start') {
          setStartTime(prev2 => prev2 ?? Date.now())
          next[event.project] = {
            completedSteps: prevState.completedSteps,
            startedAt: prevState.startedAt ?? Date.now(),
            status: 'running',
            step: event.step
          }
        } else {
          const completed = event.status === 'ok' ? [...prevState.completedSteps, event.step] : prevState.completedSteps
          next[event.project] = {
            completedSteps: completed,
            detail: event.detail,
            startedAt: prevState.startedAt,
            status: 'running',
            step: event.step
          }
        }
        return next
      })
    })
    return unsub
  }, [])
  if (allDone && !bellFiredRef.current) {
    bellFiredRef.current = true
    bell()
  }
  useEffect(() => {
    if (!allDone) return
    const timer = setTimeout(() => {
      setLastRun({ done, elapsed, failed, time: new Date().toLocaleTimeString() })
      setRunCount(c => c + 1)
      setStates(() => {
        const init: Record<string, ProjectState> = {}
        for (const p of projects) init[p.name] = mkIdle(p)
        return init
      })
      setStartTime(undefined)
      setElapsed(0)
    }, RESET_DELAY)
    return () => clearTimeout(timer)
  }, [allDone, done, elapsed, failed, projects])
  const totalSteps = total * STEP_COUNT
  const completedSteps = vals.reduce((sum, s) => sum + s.completedSteps.length, 0)
  const fraction = totalSteps > 0 ? completedSteps / totalSteps : 0
  const pct = Math.round(fraction * 100)
  const sorted = [...projects].toSorted((a, b) => {
    const sa = states[a.name]?.status ?? 'idle'
    const sb = states[b.name]?.status ?? 'idle'
    return (STATUS_ORDER[sa] ?? 9) - (STATUS_ORDER[sb] ?? 9)
  })
  const slowest = vals
    .filter(s => s.status === 'done' || s.status === 'failed')
    .toSorted((a, b) => (b.elapsed ?? 0) - (a.elapsed ?? 0))[0]
  const slowestName = slowest ? Object.entries(states).find(([, v]) => v === slowest)?.[0] : undefined
  const etaFromLast = lastRun && running > 0 ? Math.max(0, lastRun.elapsed - elapsed) : undefined
  const renderDone = () => {
    const delta = lastRun ? elapsed - lastRun.elapsed : 0
    const deltaLabel = delta > 0 ? `+${delta}s` : delta < 0 ? `${delta}s` : ''
    const deltaColor = delta > 0 ? 'red' : delta < 0 ? 'green' : undefined
    return (
      <Box flexDirection='column'>
        {failed > 0 ? (
          <Text color='red'>
            {' '}
            ✘ {failed} failed · {done} passed · {formatTime(elapsed)}
          </Text>
        ) : (
          <Box gap={1}>
            <Text bold color='green'>
              ✨ all clean · {formatTime(elapsed)}
            </Text>
            {deltaLabel && deltaColor ? <Text color={deltaColor}>({deltaLabel})</Text> : null}
          </Box>
        )}
        {slowestName && slowest?.elapsed ? (
          <Text dimColor>
            {' '}
            slowest: {slowestName} ({slowest.elapsed}s)
          </Text>
        ) : null}
      </Box>
    )
  }
  return (
    <Box flexDirection='column'>
      <Box gap={1} marginBottom={1}>
        <Text bold color='magenta'>
          ⚡ pm4ai
        </Text>
        <Text dimColor>
          v{pkg.version} · {total} projects
        </Text>
        {runCount > 0 ? <Text dimColor>· run #{runCount + 1}</Text> : null}
      </Box>
      {sorted.map(p => (
        <ProjectRow
          key={p.path}
          name={p.name}
          now={now}
          state={states[p.name] ?? { completedSteps: [], status: 'idle' }}
        />
      ))}
      <Box flexDirection='column' marginTop={1}>
        {running > 0 ? (
          <Box gap={1}>
            <Text color='cyan'> {smoothBar(fraction)}</Text>
            <Text color='yellow'>{pct}%</Text>
            {elapsed > 0 ? <Text dimColor>{formatTime(elapsed)}</Text> : null}
            {etaFromLast ? <Text dimColor>~{formatTime(etaFromLast)} left</Text> : null}
          </Box>
        ) : allDone ? (
          renderDone()
        ) : (
          <Box flexDirection='column'>
            {toast ? <Text color='cyan'> {toast}</Text> : null}
            {lastRun ? (
              <Text dimColor>
                {' '}
                last run: {lastRun.failed > 0 ? `${lastRun.failed} failed` : 'all clean'} · {formatTime(lastRun.elapsed)} ·{' '}
                {lastRun.time}
              </Text>
            ) : null}
            <Text dimColor>
              {' '}
              <Text bold dimColor>
                f
              </Text>{' '}
              fix all ·{' '}
              <Text bold dimColor>
                s
              </Text>{' '}
              status all ·{' '}
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
