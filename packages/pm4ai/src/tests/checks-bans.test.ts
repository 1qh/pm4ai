import { file, which, write } from 'bun'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkBannedImports } from '../checks.js'
setDefaultTimeout(30_000)
const URL_MOD = 'url'
const UNDICI = 'undici'
const UI_PACKAGE = '@a/ui'
const AWS_ALLOWED = '@aws-sdk/client-s3'
const AWS_BANNED = '@aws-sdk/client-dynamodb'
const BUN_CLS = 'S3Client'
const BUN_REF = `Bun.${BUN_CLS}`
const ESCAPED_QUOTE = String.raw`'\''`
const shellQuote = (value: string): string => `'${value.replaceAll("'", ESCAPED_QUOTE)}'`
const realRg = (): string => {
  const path = which('rg')
  if (path === null) throw new Error('rg is required for banned import tests')
  return path
}
const withRgShim = async (tmp: string, script: (executable: string) => string, run: () => Promise<void>) => {
  const bin = join(tmp, 'bin')
  await mkdir(bin)
  const shim = join(bin, 'rg')
  await write(shim, script(realRg()))
  await chmod(shim, 0o755)
  const previousPath = process.env.PATH
  process.env.PATH = `${bin}:${previousPath ?? ''}`
  try {
    await run()
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
  }
}
const makeProject = async (pkg: Record<string, unknown>, files: Record<string, string>): Promise<string> => {
  const tmp = await mkdtemp(join(tmpdir(), 'pm4ai-bans-'))
  await write(join(tmp, 'package.json'), JSON.stringify({ private: true, ...pkg }))
  await Promise.all(
    Object.entries(files).map(async ([rel, content]) => {
      const full = join(tmp, rel)
      await mkdir(join(full, '..'), { recursive: true })
      await write(full, content)
    })
  )
  return tmp
}
describe('checkBannedImports', () => {
  test('reports each banned package only for the file that imports it, in ban order', async () => {
    const tmp = await makeProject(
      {},
      {
        'src/blocked.ts': `import '${URL_MOD}'\nimport '${UNDICI}'\n`,
        'src/clean.tsx': 'export const value = 1\n'
      }
    )
    try {
      const issues = await checkBannedImports(tmp)
      expect(issues.length).toBeGreaterThan(0)
      expect(issues).toStrictEqual([
        { detail: `"${URL_MOD}" banned, use URL: src/blocked.ts`, type: 'forbidden' },
        { detail: '"undici" banned, use fetch: src/blocked.ts', type: 'forbidden' }
      ])
    } finally {
      await rm(tmp, { recursive: true })
    }
  })
  test.each(['app', 'lintmax'])('starts exactly two rg processes for %s bans', async name => {
    const tmp = await makeProject({}, {})
    try {
      const project = join(tmp, name)
      const countPath = join(tmp, 'rg-count')
      await mkdir(project)
      await write(
        join(project, 'a.ts'),
        `import '${UNDICI}'\nimport '${UI_PACKAGE}/lib/utils'\nconst c = new ${BUN_REF}({})\n`
      )
      await withRgShim(
        tmp,
        executable => `#!/bin/sh\nprintf '%s\\n' rg >> ${shellQuote(countPath)}\nexec ${shellQuote(executable)} "$@"\n`,
        async () => {
          const issues = await checkBannedImports(project)
          const calls = (await file(countPath).text()).trim().split('\n').filter(Boolean)
          expect({
            calls: calls.length,
            deepPath: issues.some(i => i.detail.includes('not deep paths')),
            issues: issues.length,
            namedImports: issues.some(i => i.detail.includes('use named imports'))
          }).toStrictEqual({ calls: 2, deepPath: true, issues: 3, namedImports: true })
        }
      )
    } finally {
      await rm(tmp, { recursive: true })
    }
  })
  test.each(['-f', '-g'])('surfaces an rg failure in the %s search', async argument => {
    const tmp = await makeProject({}, { 'src/clean.ts': 'export const value = 1\n' })
    try {
      await withRgShim(
        tmp,
        executable =>
          `#!/bin/sh\nif [ "$1" = ${shellQuote(argument)} ]; then\nprintf '%s\\n' 'scan unavailable' >&2\nexit 2\nfi\nexec ${shellQuote(executable)} "$@"\n`,
        async () => {
          const issues = await checkBannedImports(tmp)
          expect(issues.length).toBeGreaterThan(0)
          expect(issues).toStrictEqual([
            { detail: 'banned import scan failed: rg failed (2): scan unavailable', type: 'forbidden' }
          ])
        }
      )
    } finally {
      await rm(tmp, { recursive: true })
    }
  })
  test.each(['ts', 'js'])('preserves the Bun external exemption in tsdown.config.%s', async extension => {
    const tmp = await makeProject(
      {},
      {
        'src/s3.ts': `const c = new ${BUN_REF}({})\nexport { c }\n`,
        [`tsdown.config.${extension}`]: "export default { deps: { neverBundle: ['bun'] } }\n"
      }
    )
    try {
      const issues = await checkBannedImports(tmp)
      expect(issues).toHaveLength(0)
    } finally {
      await rm(tmp, { recursive: true })
    }
  })
  test('does not flag a banned package name inside a JSON-key string', async () => {
    const tmp = await makeProject({}, { 'src/a.ts': `const fmt = '{"${URL_MOD}":"x","q":"y"}'\nexport { fmt }\n` })
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes(`"${URL_MOD}" banned`))).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('flags a real single-quote import of a banned package', async () => {
    const tmp = await makeProject(
      {},
      { 'src/b.ts': `import { fileURLToPath } from '${URL_MOD}'\nexport { fileURLToPath }\n` }
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.type === 'forbidden' && i.detail.includes(`"${URL_MOD}" banned, use URL`))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('allows the temporary AWS S3 client package', async () => {
    const tmp = await makeProject(
      { dependencies: { [AWS_ALLOWED]: 'latest' } },
      { 'src/aws.ts': `import { S3Client } from '${AWS_ALLOWED}'\nexport { S3Client }\n` }
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('"@aws-sdk banned'))).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('keeps other AWS SDK packages banned', async () => {
    const tmp = await makeProject(
      { dependencies: { [AWS_BANNED]: 'latest' } },
      { 'src/aws.ts': `import { DynamoDBClient } from '${AWS_BANNED}'\nexport { DynamoDBClient }\n` }
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.type === 'forbidden' && i.detail.includes('"@aws-sdk banned'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('exempts the Bun global in a Next app', async () => {
    const tmp = await makeProject(
      { dependencies: { next: 'latest' } },
      { 'src/s3.ts': `const c = new ${BUN_REF}({})\nexport { c }\n` }
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('use named imports'))).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('flags the Bun global in a bun-runtime project (no next)', async () => {
    const tmp = await makeProject({}, { 'src/s3.ts': `const c = new ${BUN_REF}({})\nexport { c }\n` })
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('use named imports') && i.detail.includes(BUN_REF))).toBe(true)
    await rm(tmp, { recursive: true })
  })
})
