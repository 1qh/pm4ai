import { file, Glob } from 'bun'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
const RULES_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'apps', 'docs', 'content', 'rules')
const ESCAPED_BACKTICK = '\\`'
const RULE_GLOB = new Glob('*.mdx')
const ruleFiles = async (): Promise<string[]> => {
  const files: string[] = []
  const scanned = RULE_GLOB.scan(RULES_DIR)
  for await (const name of scanned) files.push(name)
  return files.toSorted((a, b) => a.localeCompare(b))
}
describe('rule sources', () => {
  test('carry no backslash-escaped backtick, which markdown cannot hold inside a code span', async () => {
    const names = await ruleFiles()
    expect(names.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const name of names) {
      const text = await file(join(RULES_DIR, name)).text()
      for (const [i, line] of text.split('\n').entries())
        if (line.includes(ESCAPED_BACKTICK)) offenders.push(`${name}:${i + 1}`)
    }
    expect(offenders).toStrictEqual([])
  })
})
