import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkBannedImports } from '../checks.js'

const URL_MOD = 'url'
const AWS_ALLOWED = '@aws-sdk/client-s3'
const AWS_BANNED = '@aws-sdk/client-dynamodb'
const BUN_CLS = 'S3Client'
const BUN_REF = `Bun.${BUN_CLS}`
const makeProject = (pkg: Record<string, unknown>, files: Record<string, string>): string => {
  // oxlint-disable-next-line node/no-sync
  const tmp = mkdtempSync(join(tmpdir(), 'pm4ai-bans-'))
  // oxlint-disable-next-line node/no-sync
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ private: true, ...pkg }))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(tmp, rel)
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(full, '..'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(full, content)
  }
  return tmp
}
describe('checkBannedImports', () => {
  test('does not flag a banned package name inside a JSON-key string', async () => {
    const tmp = makeProject({}, { 'src/a.ts': `const fmt = '{"${URL_MOD}":"x","q":"y"}'\nexport { fmt }\n` })
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes(`"${URL_MOD}" banned`))).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('flags a real single-quote import of a banned package', async () => {
    const tmp = makeProject({}, { 'src/b.ts': `import { fileURLToPath } from '${URL_MOD}'\nexport { fileURLToPath }\n` })
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.type === 'forbidden' && i.detail.includes(`"${URL_MOD}" banned, use URL`))).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('allows the temporary AWS S3 client package', async () => {
    const tmp = makeProject(
      { dependencies: { [AWS_ALLOWED]: 'latest' } },
      { 'src/aws.ts': `import { S3Client } from '${AWS_ALLOWED}'\nexport { S3Client }\n` }
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('"@aws-sdk banned'))).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('keeps other AWS SDK packages banned', async () => {
    const tmp = makeProject(
      { dependencies: { [AWS_BANNED]: 'latest' } },
      { 'src/aws.ts': `import { DynamoDBClient } from '${AWS_BANNED}'\nexport { DynamoDBClient }\n` }
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.type === 'forbidden' && i.detail.includes('"@aws-sdk banned'))).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('exempts the Bun global in a Next app', async () => {
    const tmp = makeProject(
      { dependencies: { next: 'latest' } },
      { 'src/s3.ts': `const c = new ${BUN_REF}({})\nexport { c }\n` }
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('use named imports'))).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('flags the Bun global in a bun-runtime project (no next)', async () => {
    const tmp = makeProject({}, { 'src/s3.ts': `const c = new ${BUN_REF}({})\nexport { c }\n` })
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('use named imports') && i.detail.includes(BUN_REF))).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
})
