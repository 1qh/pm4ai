interface WatchEvent {
  at: string
  detail?: string
  project: string
  status: WatchStatus
  step: WatchStep
}
type WatchStatus = 'fail' | 'ok' | 'start'
type WatchStep = 'audit' | 'check' | 'done' | 'maintain' | 'sync'
const WATCH_STEPS = ['audit', 'check', 'done', 'maintain', 'sync'] as const satisfies readonly WatchStep[]
const WATCH_STATUSES = ['fail', 'ok', 'start'] as const satisfies readonly WatchStatus[]
interface CreateEventArgs {
  detail?: string
  project: string
  status: WatchStatus
  step: WatchStep
}
const createEvent = ({ detail, project, status, step }: CreateEventArgs): WatchEvent => ({
  at: new Date().toISOString(),
  ...(detail ? { detail } : {}),
  project,
  status,
  step
})
export { createEvent, WATCH_STATUSES, WATCH_STEPS }
export type { CreateEventArgs, WatchEvent, WatchStatus, WatchStep }
