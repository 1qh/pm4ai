import { guide } from './guide.js'

const command = process.argv[2]
const flags = process.argv.slice(3)

const run = async () => {
  if (!command) {
    console.log(guide)
    return
  }

  if (command === 'status') {
    const { status } = await import('./status.js')
    await status(flags.includes('--swiftbar'))
    return
  }

  if (command === 'fix') {
    const { fix } = await import('./fix.js')
    await fix()
    return
  }

  console.log(guide)
}

run()
