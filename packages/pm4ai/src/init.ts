/* eslint-disable no-console */
import { $, write } from 'bun'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_DEP_VERSION, DEFAULT_SCRIPTS, EXPECTED, REQUIRED_ROOT_DEVDEPS } from './constants.js'
import { getBunVersion } from './utils.js'
const TURBO_JSON = JSON.stringify(
  {
    $schema: 'https://turbo.build/schema.json',
    tasks: {
      build: { dependsOn: ['^build'], outputs: ['.next/**', 'dist/**'] },
      check: { cache: false, dependsOn: ['build'] },
      fix: { cache: false, dependsOn: ['build'] }
    }
  },
  null,
  2
)
const TSCONFIG_JSON = JSON.stringify(
  {
    compilerOptions: { types: ['bun-types'] },
    extends: 'lintmax/tsconfig'
  },
  null,
  2
)
const CI_YML = `name: ' '
on:
  push:
  schedule:
    - cron: '0 0 * * 1'
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: sh up.sh
`
const init = async (name: string) => {
  const dir = resolve(process.cwd(), name)
  if (existsSync(dir)) {
    console.log(`${dir} already exists`)
    return
  }
  mkdirSync(dir, { recursive: true })
  const bunVersion = await getBunVersion()
  const devDependencies = Object.fromEntries(
    ['@types/bun', '@types/node', ...REQUIRED_ROOT_DEVDEPS].map(d => [d, DEFAULT_DEP_VERSION])
  )
  const pkg = JSON.stringify(
    {
      devDependencies,
      name,
      packageManager: `bun@${bunVersion}`,
      private: true,
      scripts: DEFAULT_SCRIPTS,
      'simple-git-hooks': { 'pre-commit': EXPECTED.preCommit },
      workspaces: ['packages/*', 'apps/*', 'readonly/*']
    },
    null,
    2
  )
  await Promise.all([
    write(join(dir, 'package.json'), `${pkg}\n`),
    write(join(dir, 'turbo.json'), `${TURBO_JSON}\n`),
    write(join(dir, 'tsconfig.json'), `${TSCONFIG_JSON}\n`)
  ])
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  await write(join(dir, '.github', 'workflows', 'ci.yml'), CI_YML)
  await $`git init`.cwd(dir).quiet()
  console.log(`created ${name}`)
  console.log('run: cd', name, '&& bunx pm4ai@latest fix')
}
export { init }
