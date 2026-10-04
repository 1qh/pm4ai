import { cp } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'
import { TSDOWN_BASE } from './src/constants.ts'
export default defineConfig({
  ...TSDOWN_BASE,
  entry: ['src/index.ts', 'src/guide.ts', 'src/schemas.ts', 'src/watch-socket.ts', 'src/watch-state.ts', 'src/cli.ts'],
  onSuccess: async () => {
    await cp(join(import.meta.dirname, 'src/templates'), join(import.meta.dirname, 'dist/templates'), { recursive: true })
  }
})
