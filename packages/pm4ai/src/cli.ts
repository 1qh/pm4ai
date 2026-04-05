/* eslint-disable no-console */
import pkg from '../package.json' with { type: 'json' }
import { guide } from './guide.js'
import { preflight } from './preflight.js'
import { setVerbose } from './utils.js'
const command = process.argv[2]
const flags = new Set(process.argv.slice(3))
if (flags.has('--verbose')) setVerbose(true)
if (command === '--version' || command === '-v') console.log(pkg.version)
else if (!command) console.log(guide)
else if (command === 'init') {
  const name = process.argv[3]
  if (name) {
    const { init } = await import('./init.js')
    await init(name)
  } else console.log('usage: pm4ai init <name>')
} else if (command === 'setup') {
  const { setup } = await import('./setup.js')
  await setup()
} else {
  if (!(await preflight())) throw new Error('missing required tools')
  if (command === 'status') {
    const { status } = await import('./status.js')
    await status(flags.has('--swiftbar'), flags.has('--all'))
  } else if (command === 'fix') {
    const { fix } = await import('./fix.js')
    await fix(flags.has('--all'))
  } else console.log(guide)
}
