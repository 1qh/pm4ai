import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
const SESSION_SECRET = randomUUID()
const pendingTokens = new Map<string, true>()
let currentToken: string | undefined
const loadTokenFromFile = async () => {
  try {
    const tokenFile = join(process.cwd(), '.auth-token')
    const token = (await readFile(tokenFile, 'utf8')).trim()
    if (token) {
      pendingTokens.set(token, true)
      currentToken = token
      await unlink(tokenFile)
    }
  } catch {
    /* Token file may not exist */
  }
}
await loadTokenFromFile()
const generateToken = (): string => {
  if (currentToken) pendingTokens.delete(currentToken)
  currentToken = randomUUID()
  pendingTokens.set(currentToken, true)
  return currentToken
}
const didConsumeToken = (token: string): boolean => {
  if (!pendingTokens.has(token)) return false
  pendingTokens.delete(token)
  return true
}
const createSessionCookie = (): string =>
  `pm4ai_session=${SESSION_SECRET}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`
const isValidSession = (cookieHeader: null | string): boolean => {
  if (!cookieHeader) return false
  const cookies = cookieHeader.split(';').map(c => c.trim())
  return cookies.some(c => c === `pm4ai_session=${SESSION_SECRET}`)
}
export { createSessionCookie, didConsumeToken, generateToken, isValidSession }
