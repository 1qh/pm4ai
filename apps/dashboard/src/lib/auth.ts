import { randomUUID } from 'node:crypto'
const SESSION_SECRET = randomUUID()
const pendingTokens = new Map<string, true>()
let currentToken: string | undefined
const generateToken = (): string => {
  if (currentToken) pendingTokens.delete(currentToken)
  currentToken = randomUUID()
  pendingTokens.set(currentToken, true)
  return currentToken
}
const consumeToken = (token: string): boolean => {
  if (!pendingTokens.has(token)) return false
  pendingTokens.delete(token)
  return true
}
const createSessionCookie = (): string =>
  `pm4ai_session=${SESSION_SECRET}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`
const validateSession = (cookieHeader: null | string): boolean => {
  if (!cookieHeader) return false
  const cookies = cookieHeader.split(';').map(c => c.trim())
  return cookies.some(c => c === `pm4ai_session=${SESSION_SECRET}`)
}
export { consumeToken, createSessionCookie, generateToken, validateSession }
