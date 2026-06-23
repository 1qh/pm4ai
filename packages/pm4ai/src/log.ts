import type { z } from 'zod/v4'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from './constants.js'
import { logEntrySchema, safeParseJson } from './schemas.js'

type LogEntry = z.infer<typeof logEntrySchema>
const logDir = join(homedir(), CONFIG_DIR, 'logs')
const leadingSepRe = /^--/u
const logPath = (path: string) => join(logDir, `${path.replaceAll('/', '--').replace(leadingSepRe, '')}.json`)
const readLog = (): LogEntry[] => {
  // oxlint-disable-next-line node/no-sync
  const dirExists = existsSync(logDir)
  if (!dirExists) return []
  // oxlint-disable-next-line node/no-sync
  const files = readdirSync(logDir).filter(f => f.endsWith('.json'))
  const entries: LogEntry[] = []
  for (const f of files)
    try {
      // oxlint-disable-next-line node/no-sync
      const entry = safeParseJson(logEntrySchema, readFileSync(join(logDir, f), 'utf8'))
      if (entry) entries.push(entry)
    } catch {
      /* Corrupt file */
    }
  return entries
}
const updateLog = (entry: LogEntry) => {
  // oxlint-disable-next-line node/no-sync
  mkdirSync(logDir, { recursive: true })
  // oxlint-disable-next-line node/no-sync
  writeFileSync(logPath(entry.path), JSON.stringify(entry))
}
export type { LogEntry }
export { readLog, updateLog }
