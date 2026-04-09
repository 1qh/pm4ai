import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'
export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/guide.ts', 'src/schemas.ts', 'src/watch-state.ts', 'src/cli.ts'],
  format: 'esm',
  onSuccess: () => {
    cpSync(join(import.meta.dirname, 'src/templates'), join(import.meta.dirname, 'dist/templates'), { recursive: true })
  },
  outDir: 'dist'
})
