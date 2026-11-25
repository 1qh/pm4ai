import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createSessionCookie, didConsumeToken, generateToken, isValidSession } from '../lib/auth'
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
describe('didConsumeToken', () => {
  test('valid token returns true on first use', () => {
    const token = generateToken()
    expect(didConsumeToken(token)).toBe(true)
  })
  test('same token fails on second use (one-time)', () => {
    const token = generateToken()
    didConsumeToken(token)
    expect(didConsumeToken(token)).toBe(false)
  })
  test('invalid token returns false', () => {
    expect(didConsumeToken('not-a-real-token')).toBe(false)
  })
  test('empty string returns false', () => {
    expect(didConsumeToken('')).toBe(false)
  })
  test('old token invalidated when new token generated', () => {
    const old = generateToken()
    generateToken()
    expect(didConsumeToken(old)).toBe(false)
  })
})
describe('createSessionCookie', () => {
  test.each([
    { expected: 'HttpOnly', title: 'returns HttpOnly cookie' },
    { expected: 'SameSite=Strict', title: 'has SameSite=Strict' },
    { expected: 'Path=/', title: 'has Path=/' },
    { expected: 'Max-Age=', title: 'has Max-Age' },
    { expected: 'pm4ai_session=', title: 'contains pm4ai_session key' }
  ])('$title', ({ expected }) => {
    const cookie = createSessionCookie()
    expect(cookie).toContain(expected)
  })
  test('session value is a UUID', () => {
    const cookie = createSessionCookie()
    const value = cookie.split('pm4ai_session=')[1]?.split(';')[0]
    expect(value).toMatch(uuidRe)
  })
})
describe('isValidSession', () => {
  test('returns false for null', () => {
    // biome-ignore lint/nursery/noNull: null is the JSON wire value clients and tests read
    expect(isValidSession(null)).toBe(false)
  })
  test('returns false for empty string', () => {
    expect(isValidSession('')).toBe(false)
  })
  test('returns false for random cookie', () => {
    expect(isValidSession('pm4ai_session=wrong-value')).toBe(false)
  })
  test('returns true for valid session cookie', () => {
    const cookie = createSessionCookie()
    const header = cookie.split(';')[0] ?? ''
    expect(isValidSession(header)).toBe(true)
  })
  test('returns true when valid cookie among multiple', () => {
    const cookie = createSessionCookie()
    const sessionPart = cookie.split(';')[0] ?? ''
    const header = `other=value; ${sessionPart}; another=thing`
    expect(isValidSession(header)).toBe(true)
  })
  test('returns false for malformed cookie', () => {
    expect(isValidSession('pm4ai_session=')).toBe(false)
  })
})
describe('concurrent token consumption', () => {
  test('only one consumer succeeds for same token', () => {
    const token = generateToken()
    const results = [didConsumeToken(token), didConsumeToken(token), didConsumeToken(token)]
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
describe('session isolation', () => {
  test('cookie from different session secret fails', () => {
    expect(isValidSession('pm4ai_session=wrong-secret-value')).toBe(false)
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
    for (let i = 0; i < 100; i += 1) expect(didConsumeToken(randomUUID())).toBe(false)
  })
})
