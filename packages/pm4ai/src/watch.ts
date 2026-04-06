/* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
import { Box, render, Text } from 'ink'
import { createElement, useEffect, useState } from 'react'
import pkg from '../package.json' with { type: 'json' }
import { discover } from './discover.js'
import { projectName } from './utils.js'
import { installCleanup, onEvent, startEmitter } from './watch-emitter.js'
interface ProjectState {
  detail?: string
  status: 'done' | 'idle' | 'pending'
  step?: string
}
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const stepLabel = (step: string, status: string): string => {
  if (status === 'start') return `${step}ing...`
  if (status === 'ok') return `✓ ${step}`
  return `✗ ${step}`
}
interface ProjectRowProps {
  name: string
  spinnerIdx: number
  state: ProjectState
}
const ProjectRow = ({ name, state, spinnerIdx }: ProjectRowProps) => {
  if (state.status === 'idle') {
    const detail = state.detail ?? ''
    return createElement(
      Box,
      { gap: 1 },
      createElement(Text, null, ` ${name.padEnd(20)}`),
      createElement(Text, { dimColor: true }, detail)
    )
  }
  if (state.status === 'pending')
    return createElement(
      Box,
      { gap: 1 },
      createElement(Text, null, ` ${name.padEnd(20)}`),
      createElement(Text, { dimColor: true }, '● pending')
    )
  const spinner = state.step && state.detail === undefined ? SPINNER[spinnerIdx % SPINNER.length] : ''
  const label = state.step ? stepLabel(state.step, state.detail ? 'ok' : 'start') : ''
  const detail = state.detail ?? ''
  return createElement(
    Box,
    { gap: 1 },
    createElement(Text, null, ` ${name.padEnd(20)}`),
    createElement(Text, { color: spinner ? 'yellow' : 'green' }, spinner ?? label),
    detail ? createElement(Text, { dimColor: true }, detail) : null
  )
}
interface ProjectInfo {
  name: string
  path: string
}
const WatchApp = ({ projects }: { projects: ProjectInfo[] }) => {
  const [states, setStates] = useState<Record<string, ProjectState>>(() => {
    const init: Record<string, ProjectState> = {}
    for (const p of projects) init[p.name] = { status: 'idle' }
    return init
  })
  const [connected, setConnected] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [spinnerIdx, setSpinnerIdx] = useState(0)
  const [startTime, setStartTime] = useState<number | undefined>()
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerIdx(i => i + 1)
      if (startTime) setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 80)
    return () => clearInterval(interval)
  }, [startTime])
  useEffect(() => {
    setConnected(true)
    const unsub = onEvent(event => {
      setStates(prev => {
        const next = { ...prev }
        if (event.status === 'start' && event.step !== 'done') {
          setStartTime(prev2 => prev2 ?? Date.now())
          next[event.project] = { status: 'done', step: event.step }
        } else if (event.step === 'done') next[event.project] = { detail: event.detail, status: 'done', step: 'done' }
        else next[event.project] = { detail: event.detail, status: 'done', step: event.step }
        return next
      })
    })
    return unsub
  }, [])
  const running = Object.values(states).filter(s => s.step && s.step !== 'done' && !s.detail).length
  const done = Object.values(states).filter(s => s.step === 'done').length
  const total = projects.length
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(
      Box,
      { justifyContent: 'space-between' },
      createElement(Text, { bold: true }, 'pm4ai'),
      createElement(Text, { dimColor: true }, pkg.version)
    ),
    createElement(Text, null, ''),
    ...projects.map(p =>
      createElement(ProjectRow, { key: p.path, name: p.name, spinnerIdx, state: states[p.name] ?? { status: 'idle' } })
    ),
    createElement(Text, null, ''),
    createElement(
      Text,
      { dimColor: true },
      running > 0
        ? ` fix running (${done}/${total})${elapsed > 0 ? `  ${elapsed}s elapsed` : ''}`
        : connected
          ? ' watching...'
          : ' idle — waiting for connection'
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
