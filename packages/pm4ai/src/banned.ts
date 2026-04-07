interface BannedPackage {
  ban: string
  fix: string
}
const ALLOWED_STACK = [
  '@anthropic-ai/sdk',
  '@dnd-kit',
  '@logtape/logtape',
  '@tanstack/react-form',
  '@tanstack/react-query',
  '@tanstack/react-table',
  '@types/bun',
  '@types/node',
  '@types/react',
  'ai',
  'better-auth',
  'bun',
  'bun:sqlite',
  'bun:test',
  'cnsync',
  'consola',
  'convex',
  'date-fns',
  'docker',
  'drizzle',
  'elysia',
  'es-toolkit',
  'ink',
  'ink-spinner',
  'jotai',
  'ky',
  'lintmax',
  'lucide-react',
  'motion',
  'next-themes',
  'next.js',
  'openai',
  'oRPC',
  'playwright',
  'postcss',
  'react',
  'recharts',
  'rehype',
  'remark',
  'resend',
  'shadcn',
  'simple-git-hooks',
  'spacetimedb',
  'tailwind v4',
  'tsdown',
  'turbo',
  'turbopack',
  'unified',
  'zod',
  'zustand'
] as const
const BANNED: Record<string, BannedPackage[]> = {
  animation: [
    { ban: '"anime"', fix: 'motion' },
    { ban: '"gsap"', fix: 'motion' },
    { ban: '"react-spring"', fix: 'motion' }
  ],
  api: [
    { ban: '"@trpc', fix: 'oRPC' },
    { ban: '"graphql"', fix: 'oRPC' },
    { ban: '"socket.io"', fix: 'bun WebSocket or Unix socket' },
    { ban: '"socket.io-client"', fix: 'bun WebSocket' }
  ],
  auth: [
    { ban: '"@clerk', fix: 'better-auth' },
    { ban: '"@supabase', fix: 'drizzle + better-auth' },
    { ban: '"jose"', fix: 'better-auth' },
    { ban: '"jsonwebtoken"', fix: 'better-auth' },
    { ban: '"lucia"', fix: 'better-auth' },
    { ban: '"next-auth"', fix: 'better-auth' },
    { ban: '"passport"', fix: 'better-auth' }
  ],
  backend: [
    { ban: '"@nestjs', fix: 'elysia or next.js' },
    { ban: '"adonis"', fix: 'elysia or next.js' },
    { ban: '"express"', fix: 'elysia or next.js api routes' },
    { ban: '"fastify"', fix: 'elysia or next.js api routes' },
    { ban: '"feathers"', fix: 'elysia or next.js' },
    { ban: '"hono"', fix: 'elysia or next.js api routes' },
    { ban: '"koa"', fix: 'elysia or next.js api routes' }
  ],
  build: [
    { ban: '"@swc', fix: 'bun built-in transpiler or tsdown' },
    { ban: '"esbuild"', fix: 'tsdown' },
    { ban: '"parcel"', fix: 'tsdown/turbopack' },
    { ban: '"rollup"', fix: 'tsdown' },
    { ban: '"tsup"', fix: 'tsdown' },
    { ban: '"webpack"', fix: 'tsdown/turbopack' }
  ],
  charts: [
    { ban: '"@nivo', fix: 'recharts (via shadcn)' },
    { ban: '"chart.js"', fix: 'recharts (via shadcn)' },
    { ban: '"d3"', fix: 'recharts (via shadcn)' },
    { ban: '"victory"', fix: 'recharts (via shadcn)' }
  ],
  cli: [
    { ban: '"boxen"', fix: 'ink Box' },
    { ban: '"chalk"', fix: 'ink or import { color } from bun' },
    { ban: '"clipanion"', fix: 'ink' },
    { ban: '"colorette"', fix: 'ink or import { color } from bun' },
    { ban: '"commander"', fix: 'bun process.argv' },
    { ban: '"enquirer"', fix: 'ink' },
    { ban: '"inquirer"', fix: 'ink' },
    { ban: '"meow"', fix: 'bun process.argv' },
    { ban: '"oclif"', fix: 'ink' },
    { ban: '"ora"', fix: 'ink-spinner' },
    { ban: '"picocolors"', fix: 'ink or import { color } from bun' },
    { ban: '"prompts"', fix: 'ink' },
    { ban: '"yargs"', fix: 'bun process.argv' }
  ],
  components: [
    { ban: '"@chakra-ui', fix: 'shadcn + tailwind' },
    { ban: '"@headlessui', fix: 'shadcn + cnsync' },
    { ban: '"@mantine', fix: 'shadcn + tailwind' },
    { ban: '"@mui', fix: 'shadcn + tailwind' },
    { ban: '"@radix-ui', fix: 'cnsync (readonly/ui)' },
    { ban: '"@react-aria', fix: 'shadcn + cnsync' },
    { ban: '"antd"', fix: 'shadcn + tailwind' },
    { ban: '"react-aria"', fix: 'shadcn + cnsync' }
  ],
  config: [
    { ban: '"@t3-oss/env"', fix: 'zod + bun .env auto-loading' },
    { ban: '"convict"', fix: 'bun .env auto-loading' },
    { ban: '"cosmiconfig"', fix: 'import { file } from bun' },
    { ban: '"envalid"', fix: 'zod + bun .env auto-loading' }
  ],
  crypto: [
    { ban: '"bcrypt"', fix: 'import { password } from bun' },
    { ban: '"bcryptjs"', fix: 'import { password } from bun' },
    { ban: '"cuid"', fix: 'crypto.randomUUID()' },
    { ban: '"cuid2"', fix: 'crypto.randomUUID()' },
    { ban: '"nanoid"', fix: 'crypto.randomUUID()' },
    { ban: '"ulid"', fix: 'crypto.randomUUID()' },
    { ban: '"uuid"', fix: 'crypto.randomUUID()' }
  ],
  date: [
    { ban: '"dayjs"', fix: 'date-fns' },
    { ban: '"luxon"', fix: 'date-fns' },
    { ban: '"moment"', fix: 'date-fns' }
  ],
  dbDrivers: [
    { ban: '"@neondatabase', fix: 'drizzle handles drivers' },
    { ban: '"mongodb"', fix: 'drizzle' },
    { ban: '"mysql2"', fix: 'drizzle handles drivers' },
    { ban: '"pg"', fix: 'drizzle handles drivers' },
    { ban: '"postgres"', fix: 'drizzle handles drivers' }
  ],
  dnd: [
    { ban: '"react-beautiful-dnd"', fix: '@dnd-kit' },
    { ban: '"react-dnd"', fix: '@dnd-kit' }
  ],
  e2e: [
    { ban: '"cheerio"', fix: 'playwright' },
    { ban: '"cypress"', fix: 'playwright' },
    { ban: '"nightwatch"', fix: 'playwright' },
    { ban: '"puppeteer"', fix: 'playwright' },
    { ban: '"selenium"', fix: 'playwright' },
    { ban: '"testing-library"', fix: 'bun:test + playwright' },
    { ban: '"webdriver"', fix: 'playwright' }
  ],
  expressMw: [
    { ban: '"body-parser"', fix: 'not needed with elysia/next.js' },
    { ban: '"cookie-parser"', fix: 'not needed with elysia/next.js' },
    { ban: '"cors"', fix: 'not needed with elysia/next.js' },
    { ban: '"helmet"', fix: 'not needed with elysia/next.js' },
    { ban: '"morgan"', fix: 'not needed with elysia/next.js' },
    { ban: '"multer"', fix: 'not needed with elysia/next.js' }
  ],
  files: [
    { ban: '"fast-glob"', fix: 'import { Glob } from bun' },
    { ban: '"fs-extra"', fix: 'node:fs' },
    { ban: '"glob"', fix: 'import { Glob } from bun' },
    { ban: '"micromatch"', fix: 'import { Glob } from bun' },
    { ban: '"minimatch"', fix: 'import { Glob } from bun' },
    { ban: '"mkdirp"', fix: 'node:fs mkdir recursive' },
    { ban: '"rimraf"', fix: 'node:fs or import { $ } from bun' }
  ],
  forms: [
    { ban: '"formik"', fix: 'tanstack-form' },
    { ban: '"react-hook-form"', fix: 'tanstack-form' }
  ],
  frontend: [
    { ban: '"@angular', fix: 'react' },
    { ban: '"lit"', fix: 'react' },
    { ban: '"preact"', fix: 'react' },
    { ban: '"qwik"', fix: 'react + next.js' },
    { ban: '"solid-js"', fix: 'react' },
    { ban: '"svelte"', fix: 'react' },
    { ban: '"vue"', fix: 'react' }
  ],
  http: [
    { ban: '"axios"', fix: 'fetch or ky' },
    { ban: '"got"', fix: 'fetch or ky' },
    { ban: '"node-fetch"', fix: 'fetch or ky' },
    { ban: '"superagent"', fix: 'fetch or ky' },
    { ban: '"undici"', fix: 'fetch' }
  ],
  i18n: [
    { ban: '"i18next"', fix: 'next.js built-in i18n or native Intl' },
    { ban: '"next-intl"', fix: 'next.js built-in i18n' },
    { ban: '"react-i18next"', fix: 'next.js built-in i18n' },
    { ban: '"react-intl"', fix: 'next.js built-in i18n' }
  ],
  icons: [
    { ban: '"@fortawesome', fix: 'lucide-react' },
    { ban: '"@heroicons', fix: 'lucide-react' },
    { ban: '"@iconify', fix: 'lucide-react' },
    { ban: '"font-awesome"', fix: 'lucide-react' },
    { ban: '"react-icons"', fix: 'lucide-react (from shadcn)' }
  ],
  infra: [
    { ban: '"@aws-sdk', fix: 'fetch to AWS APIs' },
    { ban: '"@sentry', fix: 'platform-managed or error boundary' },
    { ban: '"better-sqlite3"', fix: 'bun:sqlite' },
    { ban: '"bull"', fix: 'bun native or platform queues' },
    { ban: '"bullmq"', fix: 'bun native or platform queues' },
    { ban: '"compression"', fix: 'not needed with elysia/next.js' },
    { ban: '"formidable"', fix: 'not needed with elysia/next.js' },
    { ban: '"http-proxy"', fix: 'next.js rewrites or elysia' },
    { ban: '"http-proxy-middleware"', fix: 'next.js rewrites or elysia' },
    { ban: '"ioredis"', fix: 'upstash REST or platform-managed' },
    { ban: '"jimp"', fix: 'next/image optimization' },
    { ban: '"node-cron"', fix: 'bun native or platform cron' },
    { ban: '"nodemailer"', fix: 'resend' },
    { ban: '"redis"', fix: 'upstash REST or platform-managed' },
    { ban: '"sharp"', fix: 'next/image optimization' },
    { ban: '"uploadthing"', fix: 'fetch to S3/R2' },
    { ban: '"ws"', fix: 'bun native WebSocket' }
  ],
  logging: [
    { ban: '"bunyan"', fix: 'logtape or consola' },
    { ban: '"debug"', fix: 'logtape or consola' },
    { ban: '"pino"', fix: 'logtape or consola' },
    { ban: '"signale"', fix: 'logtape or consola' },
    { ban: '"winston"', fix: 'logtape or consola' }
  ],
  markdown: [
    { ban: '"markdown-it"', fix: 'remark/rehype (unified)' },
    { ban: '"marked"', fix: 'remark/rehype (unified)' }
  ],
  metaFramework: [
    { ban: '"astro"', fix: 'next.js' },
    { ban: '"gatsby"', fix: 'next.js' },
    { ban: '"nuxt"', fix: 'next.js' },
    { ban: '"redwood"', fix: 'next.js' },
    { ban: '"remix"', fix: 'next.js' },
    { ban: '"sveltekit"', fix: 'next.js' },
    { ban: '"vite"', fix: 'next.js + turbopack' }
  ],
  monorepo: [
    { ban: '"commitlint"', fix: 'not needed' },
    { ban: '"conventional-changelog"', fix: 'not needed' },
    { ban: '"lerna"', fix: 'turbo' },
    { ban: '"nx"', fix: 'turbo' }
  ],
  orm: [
    { ban: '"knex"', fix: 'drizzle' },
    { ban: '"mikro-orm"', fix: 'drizzle' },
    { ban: '"mongoose"', fix: 'drizzle' },
    { ban: '"prisma"', fix: 'drizzle' },
    { ban: '"sequelize"', fix: 'drizzle' },
    { ban: '"typeorm"', fix: 'drizzle' }
  ],
  parsing: [
    { ban: '"csv-parse"', fix: 'bun file I/O + string parsing' },
    { ban: '"fast-xml-parser"', fix: 'DOMParser or bun HTMLRewriter' },
    { ban: '"js-yaml"', fix: 'import { YAML } from bun' },
    { ban: '"papaparse"', fix: 'bun file I/O + string parsing' },
    { ban: '"xml2js"', fix: 'DOMParser or bun HTMLRewriter' },
    { ban: '"yaml"', fix: 'import { YAML } from bun' }
  ],
  process: [
    { ban: '"concurrently"', fix: 'turbo' },
    { ban: '"husky"', fix: 'simple-git-hooks' },
    { ban: '"lint-staged"', fix: 'lintmax' },
    { ban: '"npm-run-all"', fix: 'turbo' },
    { ban: '"storybook"', fix: 'not needed with shadcn' }
  ],
  reactUtils: [
    { ban: '"@tanstack/react-router"', fix: 'next.js routing' },
    { ban: '"class-variance-authority"', fix: 'cn() from shadcn' },
    { ban: '"classnames"', fix: 'cn() from shadcn' },
    { ban: '"clsx"', fix: 'cn() from shadcn' },
    { ban: '"cva"', fix: 'cn() from shadcn' },
    { ban: '"react-dropzone"', fix: 'shadcn or HTML input' },
    { ban: '"react-helmet"', fix: 'next.js metadata' },
    { ban: '"react-hot-toast"', fix: 'shadcn sonner' },
    { ban: '"react-modal"', fix: 'shadcn dialog' },
    { ban: '"react-router"', fix: 'next.js routing' },
    { ban: '"react-select"', fix: 'shadcn combobox' },
    { ban: '"react-toastify"', fix: 'shadcn sonner' },
    { ban: '"swr"', fix: 'tanstack-query' },
    { ban: '"tailwind-merge"', fix: 'cn() from shadcn' }
  ],
  retry: [
    { ban: '"async-retry"', fix: 'Promise.all or async loops' },
    { ban: '"p-limit"', fix: 'Promise.all or async loops' },
    { ban: '"p-queue"', fix: 'Promise.all or async loops' },
    { ban: '"p-retry"', fix: 'Promise.all or async loops' }
  ],
  runtime: [
    { ban: '"cross-env"', fix: 'bun .env auto-loading' },
    { ban: '"deno"', fix: 'bun' },
    { ban: '"dotenv"', fix: 'bun .env auto-loading' },
    { ban: '"nodemon"', fix: 'bun --watch' },
    { ban: '"pm2"', fix: 'docker or bun --watch' },
    { ban: '"ts-node"', fix: 'bun' },
    { ban: '"tsx"', fix: 'bun' }
  ],
  shell: [
    { ban: '"chokidar"', fix: 'import { watch } from bun' },
    { ban: '"cross-spawn"', fix: 'import { spawn } from bun' },
    { ban: '"execa"', fix: 'import { $ } from bun' },
    { ban: '"shelljs"', fix: 'import { $ } from bun' },
    { ban: '"which"', fix: 'import { $ } from bun' },
    { ban: '"zx"', fix: 'import { $ } from bun' }
  ],
  state: [
    { ban: '"effector"', fix: 'zustand or jotai' },
    { ban: '"mobx"', fix: 'zustand or jotai' },
    { ban: '"recoil"', fix: 'zustand or jotai' },
    { ban: '"@reduxjs/toolkit"', fix: 'zustand or jotai' },
    { ban: '"redux"', fix: 'zustand or jotai' },
    { ban: '"valtio"', fix: 'zustand or jotai' },
    { ban: '"xstate"', fix: 'zustand or jotai' }
  ],
  styling: [
    { ban: '"@emotion', fix: 'tailwind' },
    { ban: '"less"', fix: 'tailwind' },
    { ban: '"linaria"', fix: 'tailwind' },
    { ban: '"sass"', fix: 'tailwind' },
    { ban: '"styled-components"', fix: 'tailwind' },
    { ban: '"stylus"', fix: 'tailwind' },
    { ban: '"vanilla-extract"', fix: 'tailwind' }
  ],
  table: [
    { ban: '"ag-grid"', fix: 'tanstack-table' },
    { ban: '"react-table"', fix: 'tanstack-table' }
  ],
  test: [
    { ban: '"@jest', fix: 'bun:test' },
    { ban: '"ava"', fix: 'bun:test' },
    { ban: '"jest"', fix: 'bun:test' },
    { ban: '"mocha"', fix: 'bun:test' },
    { ban: '"tap"', fix: 'bun:test' },
    { ban: '"vitest"', fix: 'bun:test' }
  ],
  types: [{ ban: '"type-fest"', fix: 'TypeScript built-in utility types' }],
  utils: [
    { ban: '"lodash"', fix: 'es-toolkit' },
    { ban: '"ramda"', fix: 'es-toolkit' },
    { ban: '"underscore"', fix: 'es-toolkit' }
  ],
  validation: [
    { ban: '"ajv"', fix: 'zod' },
    { ban: '"joi"', fix: 'zod' },
    { ban: '"typebox"', fix: 'zod' },
    { ban: '"valibot"', fix: 'zod' },
    { ban: '"yup"', fix: 'zod' }
  ],
  versioning: [{ ban: '"semver"', fix: 'import { semver } from bun' }]
}
const LINTMAX_ONLY: BannedPackage[] = [
  { ban: '"@biomejs', fix: 'lintmax' },
  { ban: '"eslint"', fix: 'lintmax' },
  { ban: '"oxlint"', fix: 'lintmax' },
  { ban: '"prettier"', fix: 'lintmax' }
]
const ALL_BANNED: BannedPackage[] = Object.values(BANNED).flat()
export { ALL_BANNED, ALLOWED_STACK, BANNED, LINTMAX_ONLY }
export type { BannedPackage }
