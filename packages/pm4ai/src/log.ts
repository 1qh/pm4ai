import type { z } from 'zod/v4'
import { file, write } from 'bun'
import { mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from './constants.js'
import { logEntrySchema, safeParseJson } from './schemas.js'

type LogEntry = z.infer<typeof logEntrySchema>
const logDir = join(homedir(), CONFIG_DIR, 'logs')
const leadingSepRe = /^--/u
const logPath = (path: string) => join(logDir, `${path.replaceAll('/', '--').replace(leadingSepRe, '')}.json`)
const readLog = async (): Promise<LogEntry[]> => {
  let files: string[]
  try {
    files = (await readdir(logDir)).filter(f => f.endsWith('.json'))
  } catch {
    return []
  }
  const raw = await Promise.all(files.map(async f => file(join(logDir, f)).text()))
  const entries: LogEntry[] = []
  for (const content of raw) {
    const entry = safeParseJson(logEntrySchema, content)
    if (entry) entries.push(entry)
  }
  return entries
}
const updateLog = async (entry: LogEntry): Promise<void> => {
  await mkdir(logDir, { recursive: true })
  await write(logPath(entry.path), JSON.stringify(entry))
}
export type { LogEntry }
export { readLog, updateLog }
