import { write } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkNextConfigs } from '../checks.js'
describe('checkNextConfigs', () => {
  test.each([
    {
      details: [],
      source: 'export default { agentRules: false, reactStrictMode: true }',
      title: 'accepts both required settings'
    },
    {
      details: [],
      source: 'export default { agentRules\n:\tfalse, reactStrictMode: true }',
      title: 'accepts whitespace around the agentRules colon'
    },
    {
      details: ['missing agentRules: false in apps/web/next.config.ts'],
      source: 'export default { reactStrictMode: true }',
      title: 'reports exactly the missing agentRules setting'
    },
    {
      details: ['missing agentRules: false in apps/web/next.config.ts'],
      source: 'export default { agentRules: true, reactStrictMode: true }',
      title: 'reports agentRules enabled as drift'
    },
    {
      details: [],
      source: "import config from '@a/next-config'\nexport default config",
      title: 'accepts a default export delegated to an import'
    },
    {
      details: [],
      source: "import { createNextConfig } from '@a/next-config'\nexport default createNextConfig()",
      title: 'accepts createNextConfig'
    },
    {
      details: ['missing reactStrictMode in apps/web/next.config.ts'],
      source: 'export default { agentRules: false }',
      title: 'still requires reactStrictMode'
    }
  ])('$title', async ({ details, source }) => {
    const tmp = await mkdtemp(join(tmpdir(), 'pm4ai-next-configs-'))
    try {
      const app = join(tmp, 'apps', 'web')
      await mkdir(app, { recursive: true })
      await write(join(app, 'next.config.ts'), source)
      const issues = await checkNextConfigs(tmp)
      expect(issues).toEqual(details.map(detail => ({ detail, type: 'drift' })))
    } finally {
      await rm(tmp, { recursive: true })
    }
  })
})
