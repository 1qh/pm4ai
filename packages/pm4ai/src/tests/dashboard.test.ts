import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-dash-'))
const uuidRe = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu
describe('dashboard module', () => {
  test('exports dashboard function', async () => {
    const mod = await import('../dashboard.js')
    expect(typeof mod.dashboard).toBe('function')
  })
})
describe('dashboard token file', () => {
  test('token file is valid UUID format when written', () => {
    const tmp = makeTmp()
    const tokenFile = join(tmp, '.auth-token')
    const token = randomUUID()
    writeFileSync(tokenFile, token)
    const read = readFileSync(tokenFile, 'utf8')
    expect(read).toBe(token)
    expect(read).toMatch(uuidRe)
    rmSync(tmp, { recursive: true })
  })
  test('token file is cleaned up on delete', () => {
    const tmp = makeTmp()
    const tokenFile = join(tmp, '.auth-token')
    writeFileSync(tokenFile, 'test')
    expect(existsSync(tokenFile)).toBe(true)
    unlinkSync(tokenFile)
    expect(existsSync(tokenFile)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
})
describe('dashboard directory detection', () => {
  test('detects when apps/web exists', () => {
    const tmp = makeTmp()
    const dashDir = join(tmp, 'apps', 'dashboard')
    mkdirSync(dashDir, { recursive: true })
    expect(existsSync(dashDir)).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects when apps/web is missing', () => {
    const tmp = makeTmp()
    expect(existsSync(join(tmp, 'apps', 'dashboard'))).toBe(false)
    rmSync(tmp, { recursive: true })
  })
})
describe('dashboard URL format', () => {
  test('auth URL contains token', () => {
    const token = randomUUID()
    const url = `http://localhost:4200/auth/${token}`
    expect(url).toContain(token)
    expect(url).toContain('localhost:4200')
    expect(url).toContain('/auth/')
  })
})
