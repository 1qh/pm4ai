import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

export type LogEntry = {
  project: string
  path: string
  pass: boolean
  at: string
  error?: string
}

const logDir = join(homedir(), '.pm4ai')
const logFile = join(logDir, 'log.json')

export const readLog = (): LogEntry[] => {
  if (!existsSync(logFile)) return []
  return JSON.parse(readFileSync(logFile, 'utf-8'))
}

export const writeLog = (entries: LogEntry[]) => {
  mkdirSync(logDir, { recursive: true })
  writeFileSync(logFile, JSON.stringify(entries, null, 2))
}

export const updateLog = (entry: LogEntry) => {
  const entries = readLog()
  const idx = entries.findIndex(e => e.path === entry.path)
  if (idx >= 0) {
    entries[idx] = entry
  } else {
    entries.push(entry)
  }
  writeLog(entries)
}
