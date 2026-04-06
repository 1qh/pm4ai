import { Box, render, Text } from 'ink'
import { createElement, useEffect, useState } from 'react'
import pkg from '../package.json' with { type: 'json' }
import { discover } from './discover.js'
import { projectName } from './utils.js'
import { installCleanup, onEvent, startEmitter } from './watch-emitter.js'
interface ProjectState {
  completedSteps: string[]
  detail?: string
  status: 'done' | 'failed' | 'idle' | 'running'
  step?: string
}
const SPINNER = ['◐', '◓', '◑', '◒']
const STEPS = ['sync', 'audit', 'maintain', 'check']
const STEP_ICONS: Record<string, [string, string]> = {
  audit: ['🔍', 'auditing'],
  check: ['🧪', 'checking'],
  maintain: ['🔧', 'maintaining'],
  sync: ['📦', 'syncing']
}
const progressDots = (completed: string[], current?: string): string => {
  const parts: string[] = []
  for (const s of STEPS)
    if (completed.includes(s)) parts.push('●')
    else if (s === current) parts.push('◌')
    else parts.push('·')
  return parts.join('')
}
const BAR_WIDTH = 20
const progressBar = (done: number, total: number): string => {
  const filled = Math.round((done / total) * BAR_WIDTH)
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`
}
interface ProjectRowProps {
  name: string
  spinnerIdx: number
  state: ProjectState
}
const ProjectRow = ({ name, state, spinnerIdx }: ProjectRowProps) => {
  const padded = name.padEnd(24)
  if (state.status === 'idle')
    return createElement(
      Box,
      { gap: 1 },
      createElement(Text, { dimColor: true }, ' ·'),
      createElement(Text, { dimColor: true }, padded)
    )
  if (state.status === 'running') {
    const frame = SPINNER[spinnerIdx % SPINNER.length] ?? '◐'
    const [icon, verb] = STEP_ICONS[state.step ?? ''] ?? ['⚡', 'working']
    const dots = progressDots(state.completedSteps, state.step)
    return createElement(
      Box,
      { gap: 1 },
      createElement(Text, { color: 'yellow' }, ` ${frame}`),
      createElement(Text, { bold: true }, padded),
      createElement(Text, { color: 'yellow' }, `${icon} ${verb}`),
      createElement(Text, { dimColor: true }, dots)
    )
  }
  if (state.status === 'failed')
    return createElement(
      Box,
      { gap: 1 },
      createElement(Text, { color: 'red' }, ' ✘'),
      createElement(Text, null, padded),
      createElement(Text, { color: 'red' }, state.detail ?? 'failed')
    )
  return createElement(
    Box,
    { gap: 1 },
    createElement(Text, { color: 'green' }, ' ✔'),
    createElement(Text, null, padded),
    createElement(Text, { color: 'green' }, state.detail ?? 'done')
  )
}
interface ProjectInfo {
  name: string
  path: string
}
const WatchApp = ({ projects }: { projects: ProjectInfo[] }) => {
  const [states, setStates] = useState<Record<string, ProjectState>>(() => {
    const init: Record<string, ProjectState> = {}
    for (const p of projects) init[p.name] = { completedSteps: [], status: 'idle' }
    return init
  })
  const [elapsed, setElapsed] = useState(0)
  const [spinnerIdx, setSpinnerIdx] = useState(0)
  const [startTime, setStartTime] = useState<number | undefined>()
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerIdx(i => i + 1)
      if (startTime) setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 120)
    return () => clearInterval(interval)
  }, [startTime])
  useEffect(() => {
    const unsub = onEvent(event => {
      setStates(prev => {
        const next = { ...prev }
        const prevState = prev[event.project] ?? { completedSteps: [], status: 'idle' }
        if (event.step === 'done')
          next[event.project] =
            event.status === 'fail'
              ? { completedSteps: prevState.completedSteps, detail: event.detail, status: 'failed' }
              : { completedSteps: STEPS, detail: event.detail ?? 'clean', status: 'done' }
        else if (event.status === 'start') {
          setStartTime(prev2 => prev2 ?? Date.now())
          next[event.project] = { completedSteps: prevState.completedSteps, status: 'running', step: event.step }
        } else {
          const completed = event.status === 'ok' ? [...prevState.completedSteps, event.step] : prevState.completedSteps
          next[event.project] = { completedSteps: completed, detail: event.detail, status: 'running', step: event.step }
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
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(
      Box,
      { gap: 1, marginBottom: 1 },
      createElement(Text, { bold: true }, '⚡ pm4ai'),
      createElement(Text, { dimColor: true }, `v${pkg.version}`)
    ),
    ...projects.map(p =>
      createElement(ProjectRow, {
        key: p.path,
        name: p.name,
        spinnerIdx,
        state: states[p.name] ?? { completedSteps: [], status: 'idle' }
      })
    ),
    createElement(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      running > 0
        ? createElement(
            Box,
            { gap: 1 },
            createElement(Text, { color: 'yellow' }, ` ${progressBar(finished, total)}`),
            createElement(Text, { color: 'yellow' }, `${finished}/${total}`),
            elapsed > 0 ? createElement(Text, { dimColor: true }, `${elapsed}s`) : null
          )
        : allDone
          ? failed > 0
            ? createElement(Text, { color: 'red' }, ` ✘ ${failed} failed · ${done} passed · ${elapsed}s`)
            : createElement(Text, { color: 'green' }, ` ✨ all clean · ${elapsed}s`)
          : createElement(Text, { dimColor: true }, ' watching · waiting for events')
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
