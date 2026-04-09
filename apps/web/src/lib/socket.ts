/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional */
/* oxlint-disable no-empty-function, eslint-plugin-promise(prefer-await-to-then) */
/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/strict-void-return */
import type { WatchEvent } from 'pm4ai'
import { watchEventSchema } from 'pm4ai/schemas'
type Listener = (event: WatchEvent) => void
const listeners = new Set<Listener>()
let buffer = ''
let connected = false
let started = false
const ensureStarted = async () => {
  if (started) return
  started = true
  const { createConnection } = await import('node:net')
  const { existsSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const socketPath = join(homedir(), '.pm4ai', 'watch.sock')
  const doConnect = () => {
    if (!existsSync(socketPath)) {
      setTimeout(doConnect, 1000)
      return
    }
    const sock = createConnection(socketPath).on('error', () => {})
    sock.on('connect', () => {
      connected = true
    })
    sock.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines)
        if (line)
          try {
            const parsed = watchEventSchema.safeParse(JSON.parse(line))
            if (parsed.success) for (const fn of listeners) fn(parsed.data)
          } catch {}
    })
    sock.on('close', () => {
      connected = false
      setTimeout(doConnect, 1000)
    })
  }
  doConnect()
}
const subscribe = (fn: Listener): (() => void) => {
  ensureStarted().catch(() => {})
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const isConnected = () => connected
export { isConnected, subscribe }
