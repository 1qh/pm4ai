import { defineConfig } from 'tsdown'
export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/cli.ts', 'src/tui.tsx'],
  format: 'esm',
  outDir: 'dist'
})
