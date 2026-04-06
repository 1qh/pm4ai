/** biome-ignore-all lint/correctness/useExhaustiveDependencies: effect runs once */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch */
/** biome-ignore-all lint/nursery/noContinue: SSE parsing */
/** biome-ignore-all lint/nursery/useNamedCaptureGroup: regex */
/** biome-ignore-all lint/performance/noAwaitInLoops: SSE stream read */
/** biome-ignore-all lint/performance/useTopLevelRegex: used in effect */
'use client'
/* oxlint-disable no-empty-function, eslint-plugin-promise(prefer-await-to-then), eslint-plugin-react(no-array-index-key), max-depth, no-await-in-loop, no-unmodified-loop-condition */
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-void-return, react-hooks/exhaustive-deps, @typescript-eslint/no-empty-function, @typescript-eslint/no-misused-promises, @eslint-react/web-api/no-leaked-timeout, react/hook-use-state, max-depth, no-await-in-loop, no-unmodified-loop-condition, no-continue, prefer-named-capture-group */
import type { WatchEvent } from 'pm4ai'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { client } from '@/lib/client'
const timeAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
interface ProjectState {
  detail?: string
  step?: string
}
const Dashboard = () => {
  const queryClient = useQueryClient()
  const { data: projects, isLoading } = useQuery({
    queryFn: async () => {
      const res = await fetch('/api/rpc/projects', {
        body: '[]',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      })
      const data = (await res.json()) as {
        json: { checkResult: null | { at: string; pass: boolean; violations: number }; name: string; path: string }[]
      }
      return data.json
    },
    queryKey: ['projects']
  })
  const [liveState, setLiveState] = useState<Record<string, ProjectState>>({})
  const [eventLog, setEventLog] = useState<WatchEvent[]>([])
  const [startedAt] = useState(() => new Date())
  const fixMutation = useMutation({ mutationFn: async () => client.fixAll({ all: true }) })
  const statusMutation = useMutation({ mutationFn: async () => client.refreshStatus({ all: true }) })
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
              setLiveState(prev => ({
                ...prev,
                [event.project]: {
                  detail: event.detail,
                  step: event.step === 'done' ? 'done' : `${event.step}:${event.status}`
                }
              }))
              setEventLog(prev => [event, ...prev].slice(0, 100))
              if (event.step === 'done') queryClient.invalidateQueries({ queryKey: ['projects'] }).catch(() => {})
            } catch {
              /* Malformed SSE data */
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
  if (isLoading) return <div className='p-8 text-neutral-500'>Loading...</div>
  return (
    <div className='min-h-screen p-8 max-w-5xl mx-auto'>
      <header className='flex items-center justify-between mb-8'>
        <div>
          <h1 className='text-2xl font-bold'>pm4ai</h1>
          <div className='text-xs text-neutral-600'>up since {startedAt.toLocaleTimeString()}</div>
        </div>
        <div className='flex gap-3'>
          <button
            className='px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm disabled:opacity-50'
            disabled={fixMutation.isPending}
            onClick={() => fixMutation.mutate()}
            type='button'>
            {fixMutation.isPending ? 'Running...' : 'Fix All'}
          </button>
          <button
            className='px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm disabled:opacity-50'
            disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate()}
            type='button'>
            {statusMutation.isPending ? 'Checking...' : 'Status All'}
          </button>
        </div>
      </header>
      <section className='grid gap-4 mb-8'>
        {projects?.map(p => {
          const live = liveState[p.name]
          const isActive = live?.step ? live.step !== 'done' : false
          return (
            <div
              className={`p-4 rounded-lg border ${isActive ? 'border-yellow-600 bg-yellow-950/20' : 'border-neutral-800 bg-neutral-900'}`}
              key={p.path}>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <span
                    className={`w-2 h-2 rounded-full ${p.checkResult?.pass ? 'bg-green-500' : p.checkResult ? 'bg-red-500' : 'bg-neutral-600'}`}
                  />
                  <span className='font-medium'>{p.name}</span>
                </div>
                <div className='flex items-center gap-4'>
                  <div className='text-sm text-neutral-500'>
                    {isActive ? <span className='text-yellow-500'>{live?.step}</span> : null}
                    {!isActive && live?.step === 'done' ? <span className='text-green-500'>{live.detail}</span> : null}
                    {!(isActive || live?.step) && p.checkResult ? (
                      <span>
                        {p.checkResult.pass ? 'passed' : `${p.checkResult.violations} violations`}{' '}
                        {timeAgo(p.checkResult.at)}
                      </span>
                    ) : null}
                    {p.checkResult || live ? null : <span>never checked</span>}
                  </div>
                  <div className='flex gap-2 text-xs'>
                    <a
                      className='text-neutral-600 hover:text-neutral-400'
                      href={`https://github.com/1qh/${p.name}`}
                      rel='noopener noreferrer'
                      target='_blank'>
                      GitHub
                    </a>
                    <a className='text-neutral-600 hover:text-neutral-400' href={`vscode://file${p.path}`}>
                      VS Code
                    </a>
                  </div>
                </div>
              </div>
              <div className='mt-1 text-xs text-neutral-600 truncate'>{p.path}</div>
            </div>
          )
        })}
      </section>
      <section>
        <h2 className='text-lg font-semibold mb-3'>Event Log</h2>
        <div className='max-h-80 overflow-y-auto space-y-1'>
          {eventLog.length === 0 ? <div className='text-neutral-600 text-sm'>No events yet</div> : null}
          {eventLog.map((e, i) => (
            <div className='flex gap-3 text-xs text-neutral-400' key={`${e.at}-${String(i)}`}>
              <span className='text-neutral-600 w-20 shrink-0'>{new Date(e.at).toLocaleTimeString()}</span>
              <span className='w-24 shrink-0'>{e.project}</span>
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
  )
}
export default Dashboard
