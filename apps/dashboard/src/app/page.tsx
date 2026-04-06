/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: SSE handler */
/** biome-ignore-all lint/nursery/noContinue: SSE parsing */
/** biome-ignore-all lint/nursery/useNamedCaptureGroup: regex */
/** biome-ignore-all lint/performance/noAwaitInLoops: SSE stream */
/** biome-ignore-all lint/performance/useTopLevelRegex: effect */
/** biome-ignore-all lint/correctness/noUnusedFunctionParameters: reducer signature */
/** biome-ignore-all lint/correctness/useExhaustiveDependencies: effects */
'use client'
/* oxlint-disable no-empty-function, eslint-plugin-promise(prefer-await-to-then), eslint-plugin-react(no-array-index-key), max-depth, no-await-in-loop, no-unmodified-loop-condition, complexity, no-use-before-define, eslint-plugin-react-perf(jsx-no-new-object-as-prop) */
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-void-return, react-hooks/exhaustive-deps, @typescript-eslint/no-empty-function, @typescript-eslint/no-misused-promises, @eslint-react/web-api/no-leaked-timeout, max-depth, no-await-in-loop, no-unmodified-loop-condition, no-continue, prefer-named-capture-group, complexity, @eslint-react/jsx-no-iife, @typescript-eslint/no-use-before-define */
import type { WatchEvent } from 'pm4ai'
import type { ProjectInfo, ProjectState } from 'pm4ai/watch-state'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createInitState,
  deriveStats,
  formatTime,
  IDLE_FALLBACK,
  progressDots,
  runReducer,
  sparkline,
  STEP_COUNT,
  STEP_LABELS,
  timeAgo
} from 'pm4ai/watch-state'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { client } from '@/lib/client'
interface ApiProject {
  checkResult: null | { at: string; pass: boolean; violations: number }
  name: string
  path: string
}
const mkIdleFromApi = (_p: ProjectInfo, apiData?: ApiProject): ProjectState => {
  const cr = apiData?.checkResult
  if (!cr) return { completedSteps: new Set(), elapsed: 0, status: 'idle' }
  const label = `${cr.pass ? 'clean' : `${cr.violations} issues`} ${timeAgo(cr.at)}`
  return { cachedPass: cr.pass, completedSteps: new Set(), detail: label, elapsed: 0, status: 'idle' }
}
const RESET_DELAY = 5000
const statusColor = (s: ProjectState['status'], pass?: boolean) => {
  if (s === 'running') return 'text-yellow-400'
  if (s === 'failed') return 'text-red-400'
  if (s === 'done') return 'text-green-400'
  if (pass === true) return 'text-green-600'
  if (pass === false) return 'text-red-600'
  return 'text-neutral-600'
}
const statusIcon = (s: ProjectState['status'], pass?: boolean) => {
  if (s === 'running') return '◐'
  if (s === 'failed') return '✘'
  if (s === 'done') return '✔'
  if (pass !== undefined) return '●'
  return '·'
}
const Dashboard = () => {
  const queryClient = useQueryClient()
  const { data: apiProjects, isLoading } = useQuery({
    queryFn: async () => {
      const res = await fetch('/api/rpc/projects', {
        body: '[]',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      })
      const data = (await res.json()) as { json: ApiProject[] }
      const seen = new Set<string>()
      return data.json.filter(p => {
        if (seen.has(p.name)) return false
        seen.add(p.name)
        return true
      })
    },
    queryKey: ['projects']
  })
  const projects: ProjectInfo[] = useMemo(
    () => (apiProjects ?? []).map(p => ({ name: p.name, path: p.path })),
    [apiProjects]
  )
  const apiMap = useMemo(() => new Map((apiProjects ?? []).map(p => [p.name, p])), [apiProjects])
  const mkIdle = useMemo(() => (p: ProjectInfo) => mkIdleFromApi(p, apiMap.get(p.name)), [apiMap])
  const [state, dispatch] = useReducer(runReducer, { mkIdle, projects }, ({ mkIdle: mk, projects: ps }) =>
    createInitState(ps, mk)
  )
  const [eventLog, setEventLog] = useState<WatchEvent[]>([])
  const prevProjectsRef = useRef(projects)
  useEffect(() => {
    if (prevProjectsRef.current !== projects && projects.length > 0) {
      prevProjectsRef.current = projects
      dispatch({ mkIdle, projects, type: 'reset' })
    }
  }, [projects, mkIdle])
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/rpc/events', {
          body: '[]',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST'
        })
        if (!res.body) return
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += value
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() ?? ''
          for (const chunk of chunks) {
            const eventMatch = /^event: (.+)$/mu.exec(chunk)
            const dataMatch = /^data: (.*)$/mu.exec(chunk)
            if (eventMatch?.[1] === 'done') return
            if (eventMatch?.[1] !== 'message' || !dataMatch?.[1]) continue
            try {
              const event = (JSON.parse(dataMatch[1]) as { json: WatchEvent }).json
              if (!event?.project) continue
              dispatch({ event, type: 'event' })
              setEventLog(prev => [event, ...prev].slice(0, 200))
              if (event.step === 'done') queryClient.invalidateQueries({ queryKey: ['projects'] }).catch(() => {})
            } catch {
              /* Malformed SSE */
            }
          }
        }
      } catch {
        if (!cancelled) setTimeout(run, 2000)
      }
    }
    run().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'tick' }), 1000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    if (state.phase !== 'done' || (state.phase === 'done' && stats.failed > 0)) return
    const timer = setTimeout(() => dispatch({ mkIdle, projects, type: 'reset' }), RESET_DELAY)
    return () => clearTimeout(timer)
  }, [state.phase, projects, mkIdle])
  const fixMutation = useMutation({ mutationFn: async () => client.fixAll({ all: true }) })
  const statusMutation = useMutation({ mutationFn: async () => client.refreshStatus({ all: true }) })
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
  const sorted = useMemo(() => {
    if (state.sortSnapshot.length === 0) return projects
    const map = new Map(projects.map(p => [p.name, p]))
    const result: ProjectInfo[] = []
    for (const n of state.sortSnapshot) {
      const p = map.get(n)
      if (p) result.push(p)
    }
    return result
  }, [state.sortSnapshot, projects])
  const totalSteps = projects.length * STEP_COUNT
  const fraction = totalSteps > 0 ? stats.completedStepCount / totalSteps : 0
  const pct = Math.round(fraction * 100)
  const hasFails = state.phase === 'done' && stats.failed > 0
  if (isLoading) return <div className='p-8 text-neutral-500'>Loading...</div>
  return (
    <div className='min-h-screen bg-neutral-950 text-neutral-100'>
      <div className='max-w-6xl mx-auto p-6'>
        <header className='flex items-center justify-between mb-6'>
          <div className='flex items-center gap-4'>
            <h1 className='text-2xl font-bold text-purple-400'>⚡ pm4ai</h1>
            <span className='text-sm text-neutral-500'>{projects.length} projects</span>
            {state.runCount > 0 ? <span className='text-sm text-neutral-500'>· run #{state.runCount}</span> : null}
            {state.history.length > 1 ? (
              <span className='text-sm text-neutral-600 font-mono'>{sparkline(state.history)}</span>
            ) : null}
          </div>
          <div className='flex gap-3'>
            <button
              className='px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm disabled:opacity-50 transition-colors'
              disabled={fixMutation.isPending || state.phase === 'running'}
              onClick={() => fixMutation.mutate()}
              type='button'>
              {fixMutation.isPending ? 'Running...' : 'Fix All'}
            </button>
            <button
              className='px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm disabled:opacity-50 transition-colors'
              disabled={statusMutation.isPending || state.phase === 'running'}
              onClick={() => statusMutation.mutate()}
              type='button'>
              {statusMutation.isPending ? 'Checking...' : 'Status All'}
            </button>
          </div>
        </header>
        {state.phase === 'running' ? (
          <div className='mb-6'>
            <div className='flex items-center gap-3 mb-2'>
              <span className='text-sm text-yellow-400 font-mono'>{pct}%</span>
              {state.elapsed > 0 ? <span className='text-sm text-neutral-500'>{formatTime(state.elapsed)}</span> : null}
              {stats.eta !== undefined && stats.eta > 0 ? (
                <span className='text-sm text-neutral-600'>~{formatTime(stats.eta)} left</span>
              ) : null}
            </div>
            <div className='h-2 bg-neutral-800 rounded-full overflow-hidden'>
              <div
                className='h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-300 rounded-full'
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}
        {state.phase === 'done' ? (
          <div className='mb-6 p-4 rounded-lg border border-neutral-800 bg-neutral-900'>
            {hasFails ? (
              <div className='flex items-center gap-3'>
                <span className='text-red-400 font-bold'>
                  ✘ {stats.failed} failed · {stats.done} passed
                </span>
                <span className='text-neutral-500'>{formatTime(state.elapsed)}</span>
              </div>
            ) : (
              <div className='flex items-center gap-3'>
                <span className='text-green-400 font-bold'>✔ all clean</span>
                <span className='text-neutral-500'>{formatTime(state.elapsed)}</span>
                {state.lastElapsed > 0
                  ? (() => {
                      const delta = state.elapsed - state.lastElapsed
                      if (delta === 0) return null
                      return (
                        <span className={delta > 0 ? 'text-red-400' : 'text-green-400'}>
                          ({delta > 0 ? '+' : ''}
                          {delta}s)
                        </span>
                      )
                    })()
                  : null}
                {state.history.length > 1 ? (
                  <span className='text-neutral-600 font-mono'>{sparkline(state.history)}</span>
                ) : null}
              </div>
            )}
            {stats.slowestName && stats.slowestElapsed > 0 ? (
              <div className='text-sm text-neutral-500 mt-1'>
                slowest: {stats.slowestName} ({stats.slowestElapsed}s)
              </div>
            ) : null}
          </div>
        ) : null}
        <section className='grid gap-3 mb-6'>
          {sorted.map(p => {
            const ps = state.projects[p.name] ?? IDLE_FALLBACK
            const icon = statusIcon(ps.status, ps.cachedPass)
            const color = statusColor(ps.status, ps.cachedPass)
            const isRunning = ps.status === 'running'
            const stepLabel = isRunning ? (STEP_LABELS[ps.step as keyof typeof STEP_LABELS] ?? '⚡ working') : ''
            const dots = isRunning ? progressDots(ps.completedSteps, ps.step) : ''
            return (
              <div
                className={`p-4 rounded-lg border transition-colors ${isRunning ? 'border-yellow-700 bg-yellow-950/20' : ps.status === 'failed' ? 'border-red-900 bg-red-950/10' : ps.status === 'done' ? 'border-green-900 bg-green-950/10' : 'border-neutral-800 bg-neutral-900'}`}
                key={p.name}>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-3'>
                    <span className={`text-lg ${color}`}>{icon}</span>
                    <span
                      className={`font-medium ${isRunning ? 'text-white' : ps.status === 'idle' ? 'text-neutral-400' : ''}`}>
                      {p.name}
                    </span>
                    {isRunning ? (
                      <div className='flex items-center gap-2'>
                        <span className='text-yellow-400 text-sm'>{stepLabel}</span>
                        <span className='text-neutral-500 text-sm font-mono tracking-wider'>{dots}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className='flex items-center gap-4'>
                    <div className='text-sm'>
                      {isRunning && ps.elapsed > 0 ? <span className='text-neutral-500'>{ps.elapsed}s</span> : null}
                      {ps.status === 'done' ? <span className='text-green-400'>{ps.detail}</span> : null}
                      {ps.status === 'failed' ? <span className='text-red-400'>{ps.detail}</span> : null}
                      {ps.status === 'idle' && ps.detail ? <span className='text-neutral-500'>{ps.detail}</span> : null}
                      {ps.status === 'idle' && !ps.detail ? <span className='text-neutral-600'>never checked</span> : null}
                    </div>
                    {ps.status === 'done' || ps.status === 'failed' ? (
                      <span className='text-xs text-neutral-600'>{ps.elapsed > 0 ? `${ps.elapsed}s` : ''}</span>
                    ) : null}
                    <div className='flex gap-2 text-xs'>
                      <a
                        className='text-neutral-600 hover:text-neutral-400 transition-colors'
                        href={`https://github.com/1qh/${p.name}`}
                        rel='noopener noreferrer'
                        target='_blank'>
                        GitHub
                      </a>
                      <a
                        className='text-neutral-600 hover:text-neutral-400 transition-colors'
                        href={`vscode://file${p.path}`}>
                        VS Code
                      </a>
                    </div>
                  </div>
                </div>
                <div className='mt-1 text-xs text-neutral-700 truncate font-mono'>{p.path}</div>
              </div>
            )
          })}
        </section>
        {state.lastTime && state.phase === 'idle' ? (
          <div className='text-sm text-neutral-600 mb-4'>
            last run: {state.lastFailed > 0 ? `${state.lastFailed} failed` : 'all clean'} · {formatTime(state.lastElapsed)}{' '}
            · {state.lastTime}
          </div>
        ) : null}
        <section>
          <h2 className='text-lg font-semibold mb-3'>Event Log</h2>
          <div className='max-h-96 overflow-y-auto space-y-1 font-mono text-xs'>
            {eventLog.length === 0 ? <div className='text-neutral-600'>Waiting for events...</div> : null}
            {eventLog.map((e, i) => (
              <div className='flex gap-3 text-neutral-400' key={`${e.at}-${String(i)}`}>
                <span className='text-neutral-600 w-20 shrink-0'>{new Date(e.at).toLocaleTimeString()}</span>
                <span className='w-28 shrink-0'>{e.project}</span>
                <span
                  className={
                    e.status === 'fail' ? 'text-red-400' : e.status === 'ok' ? 'text-green-400' : 'text-yellow-400'
                  }>
                  {e.step}.{e.status}
                </span>
                {e.detail ? <span className='text-neutral-500'>{e.detail}</span> : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
export default Dashboard
