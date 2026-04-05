import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
interface LogEntry {
  at: string
  error?: string
  pass: boolean
  path: string
  project: string
}
const logDir = join(homedir(), '.pm4ai', 'logs')
const leadingUnderscoreRe = /^_/u
const logPath = (path: string) => join(logDir, `${path.replaceAll('/', '_').replace(leadingUnderscoreRe, '')}.json`)
const readLog = (): LogEntry[] => {
  if (!existsSync(logDir)) return []
  const files = readdirSync(logDir).filter(f => f.endsWith('.json'))
  const entries: LogEntry[] = []
  for (const f of files)
    try {
      entries.push(JSON.parse(readFileSync(join(logDir, f), 'utf8')) as LogEntry)
    } catch {
      /* Corrupt file */
    }
  return entries
}
const updateLog = (entry: LogEntry) => {
  mkdirSync(logDir, { recursive: true })
  writeFileSync(logPath(entry.path), JSON.stringify(entry))
}
export type { LogEntry }
export { readLog, updateLog }
