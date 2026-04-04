import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../init.js'
const name = `pm4ai-init-test-${Date.now()}`
const dir = join(tmpdir(), name)
describe('init', () => {
  test('creates project with all required files', async () => {
    const origCwd = process.cwd()
    process.chdir(tmpdir())
    await init(name)
    process.chdir(origCwd)
    expect(existsSync(join(dir, 'package.json'))).toBe(true)
    expect(existsSync(join(dir, 'turbo.json'))).toBe(true)
    expect(existsSync(join(dir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(dir, '.github', 'workflows', 'ci.yml'))).toBe(true)
    expect(existsSync(join(dir, '.git'))).toBe(true)
    rmSync(dir, { recursive: true })
  })
  test('package.json has correct fields', async () => {
    const origCwd = process.cwd()
    process.chdir(tmpdir())
    const testName = `pm4ai-init-pkg-${Date.now()}`
    await init(testName)
    process.chdir(origCwd)
    const testDir = join(tmpdir(), testName)
    const pkg = JSON.parse(readFileSync(join(testDir, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(pkg.name).toBe(testName)
    expect(pkg.private).toBe(true)
    expect(pkg.workspaces).toEqual(['packages/*', 'apps/*', 'readonly/*'])
    const scripts = pkg.scripts as Record<string, string>
    expect(scripts.build).toContain('turbo')
    expect(scripts.check).toBe('lintmax check')
    expect(scripts.clean).toBe('sh clean.sh')
    expect(scripts.fix).toBe('lintmax fix')
    expect(scripts.postinstall).toBe('sherif')
    expect(scripts.prepare).toBe('bunx simple-git-hooks')
    const hooks = pkg['simple-git-hooks'] as Record<string, string>
    expect(hooks['pre-commit']).toBe('sh up.sh && git add -u')
    expect((pkg.packageManager as string).startsWith('bun@')).toBe(true)
    rmSync(testDir, { recursive: true })
  })
  test('does not overwrite existing directory', async () => {
    const origCwd = process.cwd()
    process.chdir(tmpdir())
    const testName = `pm4ai-init-exist-${Date.now()}`
    await init(testName)
    const testDir = join(tmpdir(), testName)
    const pkgBefore = readFileSync(join(testDir, 'package.json'), 'utf8')
    await init(testName)
    const pkgAfter = readFileSync(join(testDir, 'package.json'), 'utf8')
    expect(pkgBefore).toBe(pkgAfter)
    process.chdir(origCwd)
    rmSync(testDir, { recursive: true })
  })
})
