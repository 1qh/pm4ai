/* oxlint-disable no-empty-function, eslint-plugin-react-perf(jsx-no-new-array-as-prop), eslint-plugin-react-perf(jsx-no-new-object-as-prop) */
import { Box, render, Text, useApp, useInput } from 'ink'
import Spinner from 'ink-spinner'
import { useState } from 'react'
import pkg from '../package.json' with { type: 'json' }
const ITEMS = ['build', 'test', 'deploy']
const App = () => {
  const app = useApp()
  const [selected, setSelected] = useState(0)
  const [running, setRunning] = useState<null | string>(null)
  const [done, setDone] = useState<Set<string>>(() => new Set())
  useInput((input, key) => {
    if (input === 'q') app.exit()
    if (key.upArrow || input === 'k') setSelected(i => Math.max(0, i - 1))
    if (key.downArrow || input === 'j') setSelected(i => Math.min(ITEMS.length - 1, i + 1))
    if (key.return && !running) {
      const item = ITEMS[selected]
      if (item && !done.has(item)) {
        setRunning(item)
        setTimeout(() => {
          setDone(prev => new Set([...prev, item]))
          setRunning(null)
        }, 1500)
      }
    }
  })
  return (
    <Box flexDirection='column'>
      <Box gap={1} paddingLeft={1}>
        <Text bold color='magenta'>
          ⚡ {pkg.name}
        </Text>
        <Text dimColor>{ITEMS.length} tasks</Text>
      </Box>
      {ITEMS.map((item, i) => (
        <Box gap={1} key={item} paddingLeft={1}>
          <Text color={i === selected ? 'cyan' : undefined}>{i === selected ? '›' : ' '}</Text>
          {running === item ? (
            <Spinner type='dots' />
          ) : (
            <Text color={done.has(item) ? 'green' : undefined}>{done.has(item) ? '✔' : '·'}</Text>
          )}
          <Text bold={i === selected}>{item}</Text>
        </Box>
      ))}
      <Box paddingLeft={1} paddingTop={1}>
        <Text dimColor>↑↓/jk select · ↵ run · q quit</Text>
      </Box>
    </Box>
  )
}
App.displayName = 'App'
const run = async () => {
  const app = render(<App />)
  await app.waitUntilExit()
}
export { run }
