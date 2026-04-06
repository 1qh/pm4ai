import { defineConfig } from 'tsdown'
export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/cli.ts', 'src/guide.ts', 'src/watch-state.ts', 'src/check-worker.ts'],
  format: 'esm',
  outDir: 'dist'
})
