import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
interface LogEntry {
  at: string
  error?: string
  pass: boolean
  path: string
  project: string
}
const logDir = join(homedir(), '.pm4ai')
const logFile = join(logDir, 'log.json')
const readLog = (): LogEntry[] => {
  if (!existsSync(logFile)) return []
  return JSON.parse(readFileSync(logFile, 'utf8')) as LogEntry[]
}
const writeLog = (entries: LogEntry[]) => {
  mkdirSync(logDir, { recursive: true })
  writeFileSync(logFile, JSON.stringify(entries, null, 2))
}
const updateLog = (entry: LogEntry) => {
  const entries = readLog()
  const idx = entries.findIndex(e => e.path === entry.path)
  if (idx === -1) entries.push(entry)
  else entries[idx] = entry
  writeLog(entries)
}
export type { LogEntry }
export { readLog, updateLog, writeLog }
