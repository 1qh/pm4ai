/* eslint-disable no-console */
import { guide } from './guide.js'
const command = process.argv[2]
const flags = new Set(process.argv.slice(3))
if (!command) console.log(guide)
else if (command === 'status') {
  const { status } = await import('./status.js')
  await status(flags.has('--swiftbar'))
} else if (command === 'fix') {
  const { fix } = await import('./fix.js')
  await fix()
} else console.log(guide)
