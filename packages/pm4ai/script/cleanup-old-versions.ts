import { spawnSync } from 'node:child_process'
import pkg from '../package.json' with { type: 'json' }
const result = spawnSync('npm', ['view', pkg.name, 'versions', '--json'], { encoding: 'utf8' })
const parsed: unknown = JSON.parse(result.stdout)
const versions = Array.isArray(parsed) ? (parsed as string[]) : []
for (const v of versions) if (v !== pkg.version) spawnSync('npm', ['unpublish', `${pkg.name}@${v}`], { stdio: 'inherit' })
