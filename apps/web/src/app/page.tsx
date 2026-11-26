/* oxlint-disable promise/prefer-await-to-then, react-perf/jsx-no-new-object-as-prop, react/exhaustive-effect-dependencies -- React-Compiler-era rule; these are intentional mount-only + explicit-dep effects in non-compiled React */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: SSE handler */
/** biome-ignore-all lint/performance/noAwaitInLoops: SSE stream */
/** biome-ignore-all lint/correctness/useExhaustiveDependencies: effects */
'use client'
/* eslint-disable @typescript-eslint/strict-void-return, react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps, @typescript-eslint/no-empty-function, @typescript-eslint/no-misused-promises, no-await-in-loop */
import type { WatchEvent } from 'pm4ai'
import type { DerivedStats, ProjectInfo, ProjectState, RunAction, RunState } from 'pm4ai/watch-state'
import { cn } from '@a/ui'
import { toast } from '@a/ui/components/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { watchEventSchema } from 'pm4ai/schemas'
import {
  createInitState,
  deriveStats,
  formatTime,
  IDLE_FALLBACK,
  progressDots,
  RESET_DELAY,
  runReducer,
  sparkline,
  STEP_COUNT,
  STEP_LABELS,
  timeAgo
} from 'pm4ai/watch-state'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { client } from '@/lib/client'
import { parseJson } from '@/lib/json'
interface ApiProject {
  checkResult: null | { at: string; pass: boolean; violations: number }
  name: string
  path: string
}
type Dispatch = (action: RunAction) => void
const eventRe = /^event: (?<name>.+)$/mu
const dataRe = /^data: (?<payload>.*)$/mu
const mkIdleFromApi = (_p: ProjectInfo, apiData?: ApiProject): ProjectState => {
  const cr = apiData?.checkResult
  if (!cr) return { completedSteps: new Set(), elapsed: 0, status: 'idle' }
  const summary = cr.pass ? 'clean' : `${cr.violations} issues`
  const label = `${summary} ${timeAgo(cr.at)}`
  return { cachedPass: cr.pass, completedSteps: new Set(), detail: label, elapsed: 0, status: 'idle' }
}
const statusColor = (s: ProjectState['status'], isPassing?: boolean) => {
  if (s === 'running') return 'text-warning'
  if (s === 'failed') return 'text-destructive'
  if (s === 'done') return 'text-success'
  if (isPassing === true) return 'text-success-muted'
  if (isPassing === false) return 'text-destructive/60'
  return 'text-muted-foreground/40'
}
const statusIcon = (s: ProjectState['status'], isPassing?: boolean) => {
  if (s === 'running') return '◐'
  if (s === 'failed') return '✘'
  if (s === 'done') return '✔'
  if (isPassing !== undefined) return '●'
  return '·'
}
const cardTone = (status: ProjectState['status'], isRunning: boolean): string => {
  if (isRunning) return 'border-warning-border bg-warning-surface/20'
  if (status === 'failed') return 'border-destructive/30 bg-destructive/5'
  if (status === 'done') return 'border-success-border bg-success-surface/10'
  return 'border-border bg-muted'
}
const nameTone = (status: ProjectState['status'], isRunning: boolean): string => {
  if (isRunning) return 'text-foreground'
  if (status === 'idle') return 'text-muted-foreground'
  return ''
}
const eventStatusTone = (status: string): string => {
  if (status === 'fail') return 'text-destructive'
  if (status === 'ok') return 'text-success'
  return 'text-warning'
}
const parseMessage = (payload: string): undefined | WatchEvent => {
  try {
    const raw = parseJson<{ json: unknown }>(payload)
    const parsed = watchEventSchema.safeParse(raw.json)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
const chunkEvent = (chunk: string): undefined | WatchEvent => {
  const payload = dataRe.exec(chunk)?.groups?.payload
  return eventRe.exec(chunk)?.groups?.name === 'message' && payload ? parseMessage(payload) : undefined
}
const chunkEvents = (chunks: string[]): { events: WatchEvent[]; isDone: boolean } => {
  const doneAt = chunks.findIndex(c => eventRe.exec(c)?.groups?.name === 'done')
  const live = doneAt === -1 ? chunks : chunks.slice(0, doneAt)
  const events = live.flatMap(c => {
    const event = chunkEvent(c)
    return event ? [event] : []
  })
  return { events, isDone: doneAt !== -1 }
}
const createChunker = () => {
  let buffer = ''
  return (value: string): string[] => {
    buffer += value
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    return chunks
  }
}
const readStream = async (
  reader: ReadableStreamDefaultReader<string>,
  isCancelled: () => boolean,
  onEvent: (event: WatchEvent) => void
) => {
  const split = createChunker()
  while (!isCancelled()) {
    const { done, value } = await reader.read()
    if (done) return
    const { events, isDone } = chunkEvents(split(value))
    for (const event of events) onEvent(event)
    if (isDone) return
  }
}
const fetchProjects = async (): Promise<ApiProject[]> => {
  const res = await fetch('/api/rpc/projects', {
    body: '[]',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  const data = parseJson<{ json: ApiProject[] }>(await res.text())
  const seen = new Set<string>()
  return data.json.filter(p => {
    if (seen.has(p.name)) return false
    seen.add(p.name)
    return true
  })
}
const CardDetail = ({ p, ps }: { p: ProjectInfo; ps: ProjectState }) => {
  const isRunning = ps.status === 'running'
  return (
    <div className='flex items-center gap-4 text-sm'>
      {isRunning && ps.elapsed > 0 ? <span className='text-muted-foreground'>{ps.elapsed}s</span> : undefined}
      {ps.status === 'done' ? <span className='text-success'>{ps.detail}</span> : undefined}
      {ps.status === 'failed' ? <span className='text-destructive'>{ps.detail}</span> : undefined}
      {ps.status === 'idle' && ps.detail ? <span className='text-muted-foreground'>{ps.detail}</span> : undefined}
      {ps.status === 'idle' && !ps.detail ? <span className='text-muted-foreground/40'>never checked</span> : undefined}
      {ps.status === 'done' || ps.status === 'failed' ? (
        <span className='text-muted-foreground/60 text-xs'>{ps.elapsed > 0 ? `${ps.elapsed}s` : ''}</span>
      ) : undefined}
      <a
        className='text-muted-foreground/60 hover:text-muted-foreground text-xs transition-colors'
        href={`https://github.com/1qh/${p.name}`}
        rel='noopener noreferrer'
        target='_blank'>
        GitHub
      </a>
      <a
        className='text-muted-foreground/60 hover:text-muted-foreground text-xs transition-colors'
        href={`vscode://file${p.path}`}>
        VS Code
      </a>
    </div>
  )
}
CardDetail.displayName = 'CardDetail'
const ProjectCard = ({ p, ps }: { p: ProjectInfo; ps: ProjectState }) => {
  const icon = statusIcon(ps.status, ps.cachedPass)
  const color = statusColor(ps.status, ps.cachedPass)
  const isRunning = ps.status === 'running'
  const labels: Record<string, string | undefined> = STEP_LABELS
  const stepLabel = isRunning ? (labels[ps.step ?? ''] ?? '⚡ working') : ''
  const dots = isRunning ? progressDots(ps.completedSteps, ps.step) : ''
  return (
    <div className={cn('rounded-lg border p-4 transition-colors', cardTone(ps.status, isRunning))}>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <span className={cn('text-lg', color)}>{icon}</span>
          <span className={cn('font-medium', nameTone(ps.status, isRunning))} data-testid={`project-name-${p.name}`}>
            {p.name}
          </span>
          {isRunning ? <span className='text-warning text-sm'>{stepLabel}</span> : undefined}
          {isRunning ? <span className='text-muted-foreground font-mono text-sm tracking-wider'>{dots}</span> : undefined}
        </div>
        <CardDetail p={p} ps={ps} />
      </div>
      <div className='text-muted-foreground/40 mt-1 truncate font-mono text-xs'>{p.path}</div>
    </div>
  )
}
ProjectCard.displayName = 'ProjectCard'
const ElapsedDelta = ({ elapsed, lastElapsed }: { elapsed: number; lastElapsed: number }) => {
  const delta = elapsed - lastElapsed
  if (delta === 0) return
  return (
    <span className={cn(delta > 0 ? 'text-destructive' : 'text-success')}>
      ({delta > 0 ? '+' : ''}
      {delta}s)
    </span>
  )
}
const useRunState = (apiProjects: ApiProject[] | undefined) => {
  const projects: ProjectInfo[] = useMemo(
    () => (apiProjects ?? []).map(p => ({ name: p.name, path: p.path })),
    [apiProjects]
  )
  const apiMap = useMemo(() => new Map((apiProjects ?? []).map(p => [p.name, p])), [apiProjects])
  const mkIdle = useMemo(() => (p: ProjectInfo) => mkIdleFromApi(p, apiMap.get(p.name)), [apiMap])
  const [state, dispatch] = useReducer(runReducer, { mkIdle, projects }, ({ mkIdle: mk, projects: ps }) =>
    createInitState(ps, mk)
  )
  const prevProjectsRef = useRef(projects)
  useEffect(() => {
    if (prevProjectsRef.current !== projects && projects.length > 0) {
      prevProjectsRef.current = projects
      dispatch({ mkIdle, projects, type: 'reset' })
    }
  }, [projects, mkIdle])
  return { dispatch, mkIdle, projects, state }
}
const useEventStream = (dispatch: Dispatch) => {
  const queryClient = useQueryClient()
  const [eventLog, setEventLog] = useState<WatchEvent[]>([])
  useEffect(() => {
    let isCancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const onEvent = (event: WatchEvent) => {
      dispatch({ event, type: 'event' })
      setEventLog(prev => [event, ...prev].slice(0, 200))
      if (event.step === 'done') queryClient.invalidateQueries({ queryKey: ['projects'] }).catch(() => {})
    }
    const run = async () => {
      try {
        const res = await fetch('/api/rpc/events', {
          body: '[]',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST'
        })
        if (!res.body) return
        await readStream(res.body.pipeThrough(new TextDecoderStream()).getReader(), () => isCancelled, onEvent)
      } catch {
        if (!isCancelled) retry = setTimeout(run, 2000)
      }
    }
    run().catch(() => {})
    return () => {
      isCancelled = true
      if (retry !== undefined) clearTimeout(retry)
    }
  }, [])
  return eventLog
}
const useRunTimers = ({
  dispatch,
  failed,
  mkIdle,
  phase,
  projects
}: {
  dispatch: Dispatch
  failed: number
  mkIdle: (p: ProjectInfo) => ProjectState
  phase: RunState['phase']
  projects: ProjectInfo[]
}) => {
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'tick' }), 1000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    if (phase !== 'done' || failed > 0) return
    const timer = setTimeout(() => dispatch({ mkIdle, projects, type: 'reset' }), RESET_DELAY)
    return () => clearTimeout(timer)
  }, [phase, projects, mkIdle])
}
const DashboardHeader = ({ projectCount, state }: { projectCount: number; state: RunState }) => {
  const fixMutation = useMutation({
    mutationFn: async () => client.fixAll({ all: true }),
    onError: () => toast.add({ title: 'Fix failed', type: 'error' }),
    onSuccess: () => toast.add({ title: 'Fix started', type: 'success' })
  })
  const statusMutation = useMutation({
    mutationFn: async () => client.refreshStatus({ all: true }),
    onError: () => toast.add({ title: 'Status check failed', type: 'error' }),
    onSuccess: () => toast.add({ title: 'Status check started', type: 'success' })
  })
  return (
    <header className='mb-6 flex items-center justify-between'>
      <div className='flex items-center gap-4'>
        <h1 className='text-brand text-2xl font-bold'>⚡ pm4ai</h1>
        <span className='text-muted-foreground text-sm'>{projectCount} projects</span>
        {state.runCount > 0 ? <span className='text-muted-foreground text-sm'>· run #{state.runCount}</span> : undefined}
        {state.history.length > 1 ? (
          <span className='text-muted-foreground/60 font-mono text-sm'>{sparkline(state.history)}</span>
        ) : undefined}
      </div>
      <div className='flex gap-3'>
        <button
          className='bg-secondary hover:bg-accent rounded-md px-4 py-2 text-sm transition-colors disabled:opacity-50'
          // biome-ignore lint/nursery/noDisabledAttribute: the control must be inert, aria-disabled keeps it clickable
          disabled={fixMutation.isPending || state.phase === 'running'}
          onClick={() => fixMutation.mutate()}
          type='button'>
          {fixMutation.isPending ? 'Running...' : 'Fix All'}
        </button>
        <button
          className='bg-secondary hover:bg-accent rounded-md px-4 py-2 text-sm transition-colors disabled:opacity-50'
          // biome-ignore lint/nursery/noDisabledAttribute: the control must be inert, aria-disabled keeps it clickable
          disabled={statusMutation.isPending || state.phase === 'running'}
          onClick={() => statusMutation.mutate()}
          type='button'>
          {statusMutation.isPending ? 'Checking...' : 'Status All'}
        </button>
      </div>
    </header>
  )
}
DashboardHeader.displayName = 'DashboardHeader'
const RunProgress = ({ elapsed, eta, pct }: { elapsed: number; eta: number | undefined; pct: number }) => (
  <div className='mb-6 flex flex-col gap-2'>
    <div className='flex items-center gap-3'>
      <span className='text-warning font-mono text-sm'>{pct}%</span>
      {elapsed > 0 ? <span className='text-muted-foreground text-sm'>{formatTime(elapsed)}</span> : undefined}
      {eta !== undefined && eta > 0 ? (
        <span className='text-muted-foreground/60 text-sm'>~{formatTime(eta)} left</span>
      ) : undefined}
    </div>
    <div className='bg-secondary h-2 overflow-hidden rounded-full'>
      <div
        className={cn(
          'from-progress-start to-progress-end h-full bg-linear-to-r',
          'rounded-full transition-all duration-300'
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  </div>
)
RunProgress.displayName = 'RunProgress'
const DoneSummary = ({ state, stats }: { state: RunState; stats: DerivedStats }) => (
  <div className='border-border bg-muted mb-6 rounded-lg border p-4'>
    {stats.failed > 0 ? (
      <div className='flex items-center gap-3'>
        <span className='text-destructive font-bold'>
          ✘ {stats.failed} failed · {stats.done} passed
        </span>
        <span className='text-muted-foreground'>{formatTime(state.elapsed)}</span>
      </div>
    ) : (
      <div className='flex items-center gap-3'>
        <span className='text-success font-bold'>✔ all clean</span>
        <span className='text-muted-foreground'>{formatTime(state.elapsed)}</span>
        {state.lastElapsed > 0 ? <ElapsedDelta elapsed={state.elapsed} lastElapsed={state.lastElapsed} /> : undefined}
        {state.history.length > 1 ? (
          <span className='text-muted-foreground/60 font-mono'>{sparkline(state.history)}</span>
        ) : undefined}
      </div>
    )}
    {stats.slowestName && stats.slowestElapsed > 0 ? (
      <div className='text-muted-foreground mt-1 text-sm'>
        slowest: {stats.slowestName} ({stats.slowestElapsed}s)
      </div>
    ) : undefined}
  </div>
)
DoneSummary.displayName = 'DoneSummary'
const LastRun = ({ state }: { state: RunState }) => (
  <div className='text-muted-foreground/60 mb-4 text-sm'>
    last run: {state.lastFailed > 0 ? `${state.lastFailed} failed` : 'all clean'}
    {' · '}
    {formatTime(state.lastElapsed)}
    {' · '}
    {state.lastTime}
  </div>
)
LastRun.displayName = 'LastRun'
const EventLog = ({ eventLog }: { eventLog: WatchEvent[] }) => (
  <section>
    <h2 className='mb-3 text-lg font-semibold'>Event Log</h2>
    <div className='max-h-96 space-y-1 overflow-y-auto font-mono text-xs'>
      {eventLog.length === 0 ? <div className='text-muted-foreground/40'>Waiting for events...</div> : undefined}
      {eventLog.map((e, i) => (
        <div className='text-muted-foreground flex gap-3' key={`${e.at}-${String(i)}`}>
          <span className='text-muted-foreground/60 w-20 shrink-0'>{new Date(e.at).toLocaleTimeString()}</span>
          <span className='w-28 shrink-0'>{e.project}</span>
          <span className={cn(eventStatusTone(e.status))}>
            {e.step}.{e.status}
          </span>
          {e.detail ? <span className='text-muted-foreground/60'>{e.detail}</span> : undefined}
        </div>
      ))}
    </div>
  </section>
)
EventLog.displayName = 'EventLog'
const Dashboard = () => {
  const { data: apiProjects, isLoading } = useQuery({ queryFn: fetchProjects, queryKey: ['projects'] })
  const { dispatch, mkIdle, projects, state } = useRunState(apiProjects)
  const eventLog = useEventStream(dispatch)
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
  useRunTimers({ dispatch, failed: stats.failed, mkIdle, phase: state.phase, projects })
  const sorted = useMemo(() => {
    if (state.sortSnapshot.length === 0) return projects
    const map = new Map(projects.map(p => [p.name, p]))
    return state.sortSnapshot.flatMap(n => {
      const p = map.get(n)
      return p ? [p] : []
    })
  }, [state.sortSnapshot, projects])
  const totalSteps = projects.length * STEP_COUNT
  const pct = Math.round((totalSteps > 0 ? stats.completedStepCount / totalSteps : 0) * 100)
  if (isLoading) return <div className='text-muted-foreground p-8'>Loading...</div>
  return (
    <div className='mx-auto max-w-6xl p-6'>
      <DashboardHeader projectCount={projects.length} state={state} />
      {state.phase === 'running' ? <RunProgress elapsed={state.elapsed} eta={stats.eta} pct={pct} /> : undefined}
      {state.phase === 'done' ? <DoneSummary state={state} stats={stats} /> : undefined}
      <section className='mb-6 grid gap-3'>
        {sorted.map(p => (
          <ProjectCard key={p.name} p={p} ps={state.projects[p.name] ?? IDLE_FALLBACK} />
        ))}
      </section>
      {state.lastTime && state.phase === 'idle' ? <LastRun state={state} /> : undefined}
      <EventLog eventLog={eventLog} />
    </div>
  )
}
export default Dashboard
