import { file, write } from 'bun'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-dash-'))
const uuidRe = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu
describe('dashboard module', () => {
  test('exports dashboard function', async () => {
    const mod = await import('../dashboard.js')
    expect(typeof mod.dashboard).toBe('function')
  })
})
describe('dashboard token file', () => {
  test('token file is valid UUID format when written', async () => {
    const tmp = await makeTmp()
    const tokenFile = join(tmp, '.auth-token')
    const token = randomUUID()
    await write(tokenFile, token)
    const read = await file(tokenFile).text()
    expect(read).toBe(token)
    expect(read).toMatch(uuidRe)
    await rm(tmp, { recursive: true })
  })
  test('token file is cleaned up on delete', async () => {
    const tmp = await makeTmp()
    const tokenFile = join(tmp, '.auth-token')
    await write(tokenFile, 'test')
    expect(await file(tokenFile).exists()).toBe(true)
    await rm(tokenFile)
    expect(await file(tokenFile).exists()).toBe(false)
    await rm(tmp, { recursive: true })
  })
})
describe('dashboard directory detection', () => {
  test('detects when apps/web exists', async () => {
    const tmp = await makeTmp()
    const dashDir = join(tmp, 'apps', 'dashboard')
    await mkdir(dashDir, { recursive: true })
    expect(await dirExists(dashDir)).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('detects when apps/web is missing', async () => {
    const tmp = await makeTmp()
    expect(await dirExists(join(tmp, 'apps', 'dashboard'))).toBe(false)
    await rm(tmp, { recursive: true })
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
