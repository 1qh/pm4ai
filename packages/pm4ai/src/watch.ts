/* eslint-disable react-hooks/purity */
/* oxlint-disable complexity */
import { Box, render, Text } from 'ink'
import Spinner from 'ink-spinner'
import { createElement, useEffect, useState } from 'react'
import pkg from '../package.json' with { type: 'json' }
import { readCheckResult } from './check-cache.js'
import { discover } from './discover.js'
import { projectName } from './utils.js'
import { installCleanup, onEvent, startEmitter } from './watch-emitter.js'
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
const progressDots = (completed: string[], current?: string): string => {
  const parts: string[] = []
  for (const s of STEPS)
    if (completed.includes(s)) parts.push('●')
    else if (s === current) parts.push('◌')
    else parts.push('·')
  return parts.join('')
}
const BAR_WIDTH = 24
const progressBar = (fraction: number): string => {
  const filled = Math.round(fraction * BAR_WIDTH)
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`
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
interface ProjectRowProps {
  name: string
  now: number
  state: ProjectState
}
const ProjectRow = ({ name, now, state }: ProjectRowProps) => {
  const padded = name.padEnd(24)
  if (state.status === 'idle') {
    const label = state.detail ?? ''
    const color = state.cachedPass === true ? 'green' : state.cachedPass === false ? 'red' : undefined
    return createElement(
      Box,
      { gap: 1 },
      color ? createElement(Text, { color }, ' ●') : createElement(Text, { dimColor: true }, ' ·'),
      createElement(Text, { dimColor: true }, padded),
      label ? createElement(Text, { dimColor: true }, label) : null
    )
  }
  if (state.status === 'running') {
    const label = STEP_LABELS[state.step ?? ''] ?? '⚡ working'
    const dots = progressDots(state.completedSteps, state.step)
    const secs = state.startedAt ? Math.floor((now - state.startedAt) / 1000) : 0
    return createElement(
      Box,
      { gap: 1 },
      createElement(Text, { color: 'yellow' }, ' '),
      createElement(Spinner, { type: 'dots' }),
      createElement(Text, { bold: true }, padded),
      createElement(Text, { color: 'yellow' }, label),
      createElement(Text, { dimColor: true }, dots),
      secs > 0 ? createElement(Text, { dimColor: true }, `${secs}s`) : null
    )
  }
  if (state.status === 'failed') {
    const secs = state.elapsed ? `${state.elapsed}s` : ''
    return createElement(
      Box,
      { gap: 1 },
      createElement(Text, { color: 'red' }, ' ✘'),
      createElement(Text, null, padded),
      createElement(Text, { color: 'red' }, state.detail ?? 'failed'),
      secs ? createElement(Text, { dimColor: true }, secs) : null
    )
  }
  const secs = state.elapsed ? `${state.elapsed}s` : ''
  return createElement(
    Box,
    { gap: 1 },
    createElement(Text, { color: 'green' }, ' ✔'),
    createElement(Text, null, padded),
    createElement(Text, { color: 'green' }, state.detail ?? 'done'),
    secs ? createElement(Text, { dimColor: true }, secs) : null
  )
}
interface ProjectInfo {
  name: string
  path: string
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
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
      if (startTime) setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 100)
    return () => clearInterval(interval)
  }, [startTime])
  useEffect(() => {
    const unsub = onEvent(event => {
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
  const vals = Object.values(states)
  const running = vals.filter(s => s.status === 'running').length
  const done = vals.filter(s => s.status === 'done').length
  const failed = vals.filter(s => s.status === 'failed').length
  const finished = done + failed
  const total = projects.length
  const allDone = finished === total && total > 0
  useEffect(() => {
    if (!allDone) return
    const timer = setTimeout(() => {
      setStates(() => {
        const init: Record<string, ProjectState> = {}
        for (const p of projects) init[p.name] = mkIdle(p)
        return init
      })
      setStartTime(undefined)
      setElapsed(0)
    }, RESET_DELAY)
    return () => clearTimeout(timer)
  }, [allDone, projects])
  const totalSteps = total * STEP_COUNT
  const completedSteps = vals.reduce((sum, s) => sum + s.completedSteps.length, 0)
  const fraction = totalSteps > 0 ? completedSteps / totalSteps : 0
  const pct = Math.round(fraction * 100)
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(
      Box,
      { gap: 1, marginBottom: 1 },
      createElement(Text, { bold: true, color: 'magenta' }, '⚡ pm4ai'),
      createElement(Text, { dimColor: true }, `v${pkg.version} · ${total} projects`)
    ),
    ...projects.map(p =>
      createElement(ProjectRow, {
        key: p.path,
        name: p.name,
        now,
        state: states[p.name] ?? { completedSteps: [], status: 'idle' }
      })
    ),
    createElement(
      Box,
      { marginTop: 1 },
      running > 0
        ? createElement(
            Box,
            { gap: 1 },
            createElement(Text, { color: 'cyan' }, ` ${progressBar(fraction)}`),
            createElement(Text, { color: 'yellow' }, `${pct}%`),
            elapsed > 0 ? createElement(Text, { dimColor: true }, formatTime(elapsed)) : null
          )
        : allDone
          ? failed > 0
            ? createElement(Text, { color: 'red' }, ` ✘ ${failed} failed · ${done} passed · ${formatTime(elapsed)}`)
            : createElement(Text, { bold: true, color: 'green' }, ` ✨ all clean · ${formatTime(elapsed)}`)
          : createElement(Text, { dimColor: true }, ' watching · ctrl+c to exit')
    )
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
  const app = render(createElement(WatchApp, { projects }))
  await app.waitUntilExit()
}
export { watch, WatchApp }
