/* oxlint-disable eslint-plugin-node(global-require), eslint-plugin-unicorn(prefer-module) */
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { consumeToken, createSessionCookie, generateToken, validateSession } from '../lib/auth'
const uuidRe = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu
describe('generateToken', () => {
  test('returns a UUID v4 string', () => {
    const token = generateToken()
    expect(token).toMatch(uuidRe)
  })
  test('generates different tokens each call', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
  })
})
describe('consumeToken', () => {
  test('valid token returns true on first use', () => {
    const token = generateToken()
    expect(consumeToken(token)).toBe(true)
  })
  test('same token fails on second use (one-time)', () => {
    const token = generateToken()
    consumeToken(token)
    expect(consumeToken(token)).toBe(false)
  })
  test('invalid token returns false', () => {
    expect(consumeToken('not-a-real-token')).toBe(false)
  })
  test('empty string returns false', () => {
    expect(consumeToken('')).toBe(false)
  })
  test('old token invalidated when new token generated', () => {
    const old = generateToken()
    generateToken()
    expect(consumeToken(old)).toBe(false)
  })
})
describe('createSessionCookie', () => {
  test('returns HttpOnly cookie', () => {
    const cookie = createSessionCookie()
    expect(cookie).toContain('HttpOnly')
  })
  test('has SameSite=Strict', () => {
    const cookie = createSessionCookie()
    expect(cookie).toContain('SameSite=Strict')
  })
  test('has Path=/', () => {
    const cookie = createSessionCookie()
    expect(cookie).toContain('Path=/')
  })
  test('has Max-Age', () => {
    const cookie = createSessionCookie()
    expect(cookie).toContain('Max-Age=')
  })
  test('contains pm4ai_session key', () => {
    const cookie = createSessionCookie()
    expect(cookie).toContain('pm4ai_session=')
  })
  test('session value is a UUID', () => {
    const cookie = createSessionCookie()
    const value = cookie.split('pm4ai_session=')[1]?.split(';')[0]
    expect(value).toMatch(uuidRe)
  })
})
describe('validateSession', () => {
  test('returns false for null', () => {
    expect(validateSession(null)).toBe(false)
  })
  test('returns false for empty string', () => {
    expect(validateSession('')).toBe(false)
  })
  test('returns false for random cookie', () => {
    expect(validateSession('pm4ai_session=wrong-value')).toBe(false)
  })
  test('returns true for valid session cookie', () => {
    const cookie = createSessionCookie()
    const header = cookie.split(';')[0] ?? ''
    expect(validateSession(header)).toBe(true)
  })
  test('returns true when valid cookie among multiple', () => {
    const cookie = createSessionCookie()
    const sessionPart = cookie.split(';')[0] ?? ''
    const header = `other=value; ${sessionPart}; another=thing`
    expect(validateSession(header)).toBe(true)
  })
  test('returns false for malformed cookie', () => {
    expect(validateSession('pm4ai_session=')).toBe(false)
  })
})
describe('concurrent token consumption', () => {
  test('only one consumer succeeds for same token', () => {
    const token = generateToken()
    const results = [consumeToken(token), consumeToken(token), consumeToken(token)]
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
describe('session isolation', () => {
  test('cookie from different session secret fails', () => {
    expect(validateSession('pm4ai_session=wrong-secret-value')).toBe(false)
  })
  test('session cookie is consistent across calls', () => {
    const a = createSessionCookie()
    const b = createSessionCookie()
    expect(a).toBe(b)
  })
  test('token not in cookie value', () => {
    const token = generateToken()
    const cookie = createSessionCookie()
    expect(cookie).not.toContain(token)
  })
})
describe('brute force resistance', () => {
  test('100 random UUIDs all fail', () => {
    for (let i = 0; i < 100; i += 1) expect(consumeToken(randomUUID())).toBe(false)
  })
})
