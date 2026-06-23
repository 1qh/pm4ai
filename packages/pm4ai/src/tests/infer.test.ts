import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inferRules, parseFrontmatter } from '../infer.js'
// oxlint-disable-next-line node/no-sync
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-infer-'))
describe('parseFrontmatter', () => {
  test('standard frontmatter', () => {
    expect(parseFrontmatter('---\ntitle: Hello\ninfer: always\n---\ncontent')).toEqual({
      infer: 'always',
      title: 'Hello'
    })
  })
  test('no frontmatter returns empty object', () => {
    expect(parseFrontmatter('just content')).toEqual({})
  })
  test('missing closing --- returns empty object', () => {
    expect(parseFrontmatter('---\ntitle: Hello\n')).toEqual({})
  })
  test('values with colons keeps full value', () => {
    expect(parseFrontmatter('---\nurl: https://example.com\n---\n')).toEqual({
      url: 'https://example.com'
    })
  })
  test('empty file returns empty object', () => {
    expect(parseFrontmatter('')).toEqual({})
  })
})
describe('inferRules', () => {
  test('includes always rules regardless of deps', async () => {
    const tmp = makeTmp()
    const rulesDir = join(tmp, 'rules')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(rulesDir)
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(rulesDir, 'base.mdx'), '---\ntitle: Base\ninfer: always\n---\nbase content')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const rules = await inferRules(tmp, rulesDir)
    expect(rules).toContain('base')
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('includes dep-based rules when dep is present', async () => {
    const tmp = makeTmp()
    const rulesDir = join(tmp, 'rules')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(rulesDir)
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(rulesDir, 'react.mdx'), '---\ntitle: React\ninfer: react\n---\nreact content')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { react: 'latest' }, name: 'test', private: true })
    )
    const rules = await inferRules(tmp, rulesDir)
    expect(rules).toContain('react')
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('excludes dep-based rules when dep is absent', async () => {
    const tmp = makeTmp()
    const rulesDir = join(tmp, 'rules')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(rulesDir)
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(rulesDir, 'react.mdx'), '---\ntitle: React\ninfer: react\n---\nreact content')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const rules = await inferRules(tmp, rulesDir)
    expect(rules).not.toContain('react')
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('excludes files without infer frontmatter', async () => {
    const tmp = makeTmp()
    const rulesDir = join(tmp, 'rules')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(rulesDir)
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(rulesDir, 'noinfer.mdx'), '---\ntitle: No Infer\n---\ncontent')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const rules = await inferRules(tmp, rulesDir)
    expect(rules).toHaveLength(0)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('index.mdx comes first in order', async () => {
    const tmp = makeTmp()
    const rulesDir = join(tmp, 'rules')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(rulesDir)
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(rulesDir, 'index.mdx'), '---\ntitle: Index\ninfer: always\n---\nindex')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(rulesDir, 'zzz.mdx'), '---\ntitle: ZZZ\ninfer: always\n---\nzzz')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(rulesDir, 'aaa.mdx'), '---\ntitle: AAA\ninfer: always\n---\naaa')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const rules = await inferRules(tmp, rulesDir)
    expect(rules[0]).toBe('index')
    expect(rules[1]).toBe('aaa')
    expect(rules[2]).toBe('zzz')
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('returns empty when rules dir does not exist', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const rules = await inferRules(tmp, join(tmp, 'nonexistent'))
    expect(rules).toHaveLength(0)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('checks workspace sub-package deps', async () => {
    const tmp = makeTmp()
    const rulesDir = join(tmp, 'rules')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(rulesDir)
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, 'apps', 'web'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(rulesDir, 'next.mdx'), '---\ntitle: Next\ninfer: next\n---\nnext content')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, workspaces: ['apps/*'] }))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(tmp, 'apps', 'web', 'package.json'),
      JSON.stringify({ dependencies: { next: 'latest' }, name: '@a/web' })
    )
    const rules = await inferRules(tmp, rulesDir)
    expect(rules).toContain('next')
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
})
