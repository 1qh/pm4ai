import type { NextConfig } from 'next'
const config: NextConfig = {
  agentRules: false,
  // biome-ignore lint/style/noProcessEnv: the build dir is deliberately configurable
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true
}
export default config
