import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncConfigs, syncPackageJson } from '../sync.js'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-test-'))
describe('syncConfigs', () => {
  test('copies verbatim files from source to dest', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    writeFileSync(join(src, 'clean.sh'), '#!/bin/sh\nrm -rf dist')
    writeFileSync(join(src, 'up.sh'), '#!/bin/sh\nbun i')
    const issues = await syncConfigs(src, dst)
    expect(issues.length).toBeGreaterThan(0)
    expect(existsSync(join(dst, 'clean.sh'))).toBe(true)
    expect(readFileSync(join(dst, 'clean.sh'), 'utf8')).toBe('#!/bin/sh\nrm -rf dist')
    rmSync(src, { recursive: true })
    rmSync(dst, { recursive: true })
  })
  test('no issues when files already match', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    writeFileSync(join(src, 'clean.sh'), 'content')
    writeFileSync(join(dst, 'clean.sh'), 'content')
    const issues = await syncConfigs(src, dst)
    const cleanIssue = issues.find(i => i.detail.includes('clean.sh'))
    expect(cleanIssue).toBeUndefined()
    rmSync(src, { recursive: true })
    rmSync(dst, { recursive: true })
  })
})
describe('syncPackageJson', () => {
  test('adds sherif and hooks to minimal package.json', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const issues = await syncPackageJson(tmp)
    const details = issues.map(i => i.detail)
    expect(details).toContain('added sherif to postinstall')
    expect(details).toContain('added simple-git-hooks')
    expect(details).toContain('added prepare script')
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(pkg.scripts?.postinstall).toContain('sherif')
    expect(pkg.scripts?.prepare).toBe('bunx simple-git-hooks')
    expect(pkg['simple-git-hooks']).toBeDefined()
    expect(pkg.devDependencies?.sherif).toBe('latest')
    rmSync(tmp, { recursive: true })
  })
})
