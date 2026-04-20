/* eslint-disable @typescript-eslint/consistent-type-imports */
interface BannedPackage {
  ban: string
  fix: string
}
/* oxlint-disable typescript-eslint/consistent-type-imports */
type BunExport = keyof typeof import('bun')
const b = (...names: BunExport[]) => `import { ${names.join(', ')} } from bun`
type NodeModule =
  | 'assert'
  | 'buffer'
  | 'child_process'
  | 'cluster'
  | 'console'
  | 'crypto'
  | 'dgram'
  | 'diagnostics_channel'
  | 'dns'
  | 'events'
  | 'fs'
  | 'fs/promises'
  | 'http2'
  | 'http'
  | 'https'
  | 'module'
  | 'net'
  | 'os'
  | 'path'
  | 'path/posix'
  | 'perf_hooks'
  | 'process'
  | 'querystring'
  | 'readline'
  | 'stream'
  | 'string_decoder'
  | 'timers'
  | 'tls'
  | 'tty'
  | 'url'
  | 'util'
  | 'v8'
  | 'vm'
  | 'wasi'
  | 'worker_threads'
  | 'zlib'
type WebAPI =
  | 'AbortController'
  | 'AbortSignal'
  | 'atob'
  | 'Blob'
  | 'BroadcastChannel'
  | 'btoa'
  | 'CompressionStream'
  | 'crypto'
  | 'DecompressionStream'
  | 'EventTarget'
  | 'fetch'
  | 'FormData'
  | 'Headers'
  | 'HTMLRewriter'
  | 'Intl'
  | 'JSON'
  | 'Map'
  | 'MessageChannel'
  | 'MessagePort'
  | 'Promise'
  | 'queueMicrotask'
  | 'ReadableStream'
  | 'RegExp'
  | 'Request'
  | 'Response'
  | 'Set'
  | 'structuredClone'
  | 'SubtleCrypto'
  | 'TextDecoder'
  | 'TextEncoder'
  | 'TransformStream'
  | 'URL'
  | 'URLPattern'
  | 'URLSearchParams'
  | 'WebSocket'
  | 'Worker'
  | 'WritableStream'
const n = (mod: NodeModule, detail?: string) => (detail ? `node:${mod} ${detail}` : `node:${mod}`)
const w = (api: WebAPI, detail?: string) => (detail ? `${api} ${detail}` : api)
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
const BANNED: Record<string, Record<string, string[]>> = {
  animation: {
    motion: [
      '"@formkit/auto-animate"',
      '"anime"',
      '"gsap"',
      '"lottie-react"',
      '"lottie-web"',
      '"react-flip-move"',
      '"react-spring"',
      '"react-transition-group"'
    ]
  },
  api: {
    'bun WebSocket': ['"socket.io-client"'],
    'bun WebSocket or Unix socket': ['"socket.io"'],
    oRPC: ['"@apollo/server"', '"@trpc', '"graphql"', '"graphql-codegen"', '"json-schema-to-typescript"'],
    'oRPC or tanstack-query': ['"@apollo/client"', '"urql"']
  },
  auth: {
    'better-auth': ['"jose"', '"jsonwebtoken"', '"lucia"', '"next-auth"', '"passport"'],
    'drizzle + better-auth': ['"@clerk', '"@firebase', '"@supabase', '"firebase"']
  },
  backend: {
    'elysia or next.js': ['"@nestjs', '"adonis"', '"feathers"'],
    'elysia or next.js api routes': ['"express"', '"fastify"', '"hono"', '"koa"']
  },
  build: {
    'bun built-in transpiler or tsdown': [
      '"@babel',
      '"@swc',
      '"babel-cli"',
      '"babel-core"',
      '"babel-plugin-transform',
      '"babel-preset-env"',
      '"babel-register"'
    ],
    'not needed': ['"bower"', '"broccoli"', '"grunt"', '"gulp"'],
    tsdown: [
      '"bunchee"',
      '"esbuild"',
      '"ncc"',
      '"pkgroll"',
      '"rollup"',
      '"sucrase"',
      '"terser"',
      '"tsc-alias"',
      '"tslib"',
      '"tsup"',
      '"uglify-js"',
      '"unbuild"',
      '"unplugin"',
      '"vite-plugin-dts"'
    ],
    'tsdown/turbopack': ['"babel-loader"', '"browserify"', '"parcel"', '"swc-loader"', '"ts-loader"', '"webpack"']
  },
  carousel: {
    'shadcn carousel': ['"keen-slider"', '"react-slick"', '"slick-carousel"', '"splide"', '"swiper"']
  },
  charts: {
    'recharts (via shadcn)': ['"@nivo', '"chart.js"', '"d3"', '"tremor"', '"victory"']
  },
  cli: {
    'bun process.argv': ['"arg"', '"cac"', '"citty"', '"commander"', '"meow"', '"minimist"', '"nopt"', '"yargs"'],
    ink: [
      '"blessed"',
      '"cli-table"',
      '"cli-table3"',
      '"cli-truncate"',
      '"cliui"',
      '"clipanion"',
      '"enquirer"',
      '"figures"',
      '"inquirer"',
      '"listr2"',
      '"log-symbols"',
      '"log-update"',
      '"oclif"',
      '"cli-progress"',
      '"prompts"',
      '"terminal-kit"',
      '"terminal-link"'
    ],
    'ink Box': ['"boxen"'],
    [`ink or ${b('$')}`]: ['"clipboardy"'],
    [`ink or ${b('color')}`]: [
      '"ansi-colors"',
      '"ansi-styles"',
      '"chalk"',
      '"chalk-template"',
      '"colorette"',
      '"kleur"',
      '"picocolors"',
      '"supports-color"',
      '"yoctocolors"'
    ],
    'ink-spinner': ['"cli-spinners"', '"ora"', '"progress"']
  },
  codeGen: {
    'bun scripts': ['"hygen"', '"plop"', '"yeoman-generator"']
  },
  compat: {
    'async/await': ['"co"', '"fibers"'],
    [w('AbortController')]: ['"abortcontroller-polyfill"'],
    [w('Blob')]: ['"cross-blob"', '"fetch-blob"'],
    'native ES2024+ in bun': [
      '"babel-polyfill"',
      '"core-js"',
      '"es5-shim"',
      '"es6-promise"',
      '"es6-shim"',
      '"left-pad"',
      '"object-assign"',
      '"regenerator-runtime"',
      '"setimmediate"'
    ],
    [w('FormData')]: ['"form-data"', '"formdata-node"'],
    [w('Promise')]: ['"any-promise"', '"bluebird"', '"lie"', '"pinkie"', '"q"', '"rsvp"'],
    [w('ReadableStream')]: ['"web-streams-polyfill"'],
    [w('URL')]: ['"whatwg-url"'],
    [w('fetch')]: ['"whatwg-fetch"'],
    [n('path')]: ['"path-browserify"'],
    [n('stream')]: ['"readable-stream"', '"stream-browserify"'],
    [`${n('util')} promisify or ${n('fs/promises')}`]: ['"mz"', '"pify"', '"thenify"']
  },
  components: {
    'cnsync (readonly/ui)': ['"@radix-ui'],
    'shadcn + cnsync': [
      '"@ariakit/react"',
      '"@headlessui',
      '"@react-aria',
      '"rc-checkbox"',
      '"rc-collapse"',
      '"rc-dialog"',
      '"rc-dropdown"',
      '"rc-field-form"',
      '"rc-form"',
      '"rc-input-number"',
      '"rc-menu"',
      '"rc-notification"',
      '"rc-pagination"',
      '"rc-picker"',
      '"rc-progress"',
      '"rc-select"',
      '"rc-slider"',
      '"rc-switch"',
      '"rc-tabs"',
      '"rc-tooltip"',
      '"rc-upload"',
      '"react-aria"'
    ],
    'shadcn + tailwind': [
      '"@blueprintjs/core"',
      '"@chakra-ui',
      '"@mantine',
      '"@mui',
      '"@nextui-org/react"',
      '"antd"',
      '"daisyui"',
      '"evergreen-ui"',
      '"flowbite"',
      '"grommet"',
      '"primereact"',
      '"react-bootstrap"',
      '"reactstrap"',
      '"rsuite"',
      '"semantic-ui-react"'
    ]
  },
  compression: {
    [b('Archive')]: ['"archiver"', '"tar"', '"tar-fs"', '"tar-stream"'],
    [b('gzipSync', 'deflateSync')]: ['"adm-zip"', '"fflate"', '"jszip"', '"lz-string"', '"pako"']
  },
  config: {
    'bun .env auto-loading': ['"convict"'],
    [b('file')]: ['"conf"', '"configstore"', '"cosmiconfig"'],
    'zod + bun .env auto-loading': ['"@t3-oss/env', '"envalid"']
  },
  crypto: {
    'crypto.randomUUID()': [
      '"cuid"',
      '"@paralleldrive/cuid2"',
      '"flake-idgen"',
      '"hyperid"',
      '"ksuid"',
      '"nanoid"',
      '"short-uuid"',
      '"ulid"',
      '"uuid"',
      '"xid"'
    ],
    [b('password')]: ['"argon2"', '"bcrypt"', '"bcryptjs"', '"scrypt-js"'],
    [w('SubtleCrypto')]: ['"crypto-js"', '"node-forge"', '"node-rsa"', '"tweetnacl"']
  },
  date: {
    'date-fns': ['"dayjs"', '"luxon"', '"moment"', '"moment-timezone"']
  },
  dbDrivers: {
    drizzle: ['"mongodb"'],
    [`drizzle or ${b('sql')}`]: [
      '"@neondatabase',
      '"@planetscale/database"',
      '"@vercel/postgres"',
      '"libsql"',
      '"mysql2"',
      '"pg"',
      '"postgres"'
    ]
  },
  dnd: {
    '@dnd-kit': ['"react-beautiful-dnd"', '"react-dnd"', '"react-draggable"', '"react-sortable-hoc"']
  },
  e2e: {
    'bun:test + playwright': ['"enzyme"', '"react-test-renderer"'],
    playwright: ['"cheerio"', '"cypress"', '"nightwatch"', '"puppeteer"', '"selenium"', '"webdriver"']
  },
  email: {
    resend: ['"@sendgrid/mail"', '"mailgun.js"', '"postmark"']
  },
  encoding: {
    [b('escapeHTML')]: ['"entities"', '"escape-html"', '"he"'],
    [`${w('Response')} headers or elysia`]: ['"content-type"', '"mime"', '"mime-types"'],
    [w('TextDecoder')]: ['"iconv-lite"'],
    [w('URL')]: ['"url"', '"url-parse"'],
    [w('URLSearchParams')]: ['"qs"', '"query-string"', '"querystring"'],
    [`${w('atob')}/${w('btoa')}`]: ['"base64-js"', '"js-base64"']
  },
  errorTracking: {
    'platform-managed or error boundary': ['"@bugsnag/js"', '"@honeybadger-io/js"', '"rollbar"']
  },
  expressMw: {
    'not needed with elysia/next.js': [
      '"body-parser"',
      '"busboy"',
      '"cookie-parser"',
      '"cors"',
      '"express-rate-limit"',
      '"helmet"',
      '"morgan"',
      '"multer"'
    ]
  },
  files: {
    [b('Glob')]: [
      '"@nodelib/fs.walk"',
      '"fast-glob"',
      '"glob"',
      '"klaw"',
      '"micromatch"',
      '"minimatch"',
      '"globby"',
      '"tinyglobby"',
      '"is-extglob"',
      '"is-glob"',
      '"readdirp"',
      '"recursive-readdir"',
      '"walk"'
    ],
    [`${b('Glob')} or ${n('fs')} walk`]: ['"find-up"', '"pkg-dir"'],
    'import.meta.resolve': ['"resolve"', '"resolve-from"'],
    [n('fs')]: [
      '"cpy"',
      '"fs-extra"',
      '"graceful-fs"',
      '"load-json-file"',
      '"ncp"',
      '"proper-lockfile"',
      '"write-file-atomic"',
      '"write-json-file"'
    ],
    [n('fs', 'mkdir recursive')]: ['"make-dir"', '"mkdirp"'],
    [`${n('fs')} or ${b('$')}`]: ['"del"', '"rimraf"'],
    [`${n('os')} tmpdir + ${n('fs')}`]: ['"tmp"', '"tmp-promise"'],
    [n('path')]: ['"normalize-path"'],
    [n('path/posix')]: ['"slash"'],
    [b('readableStreamToText', 'readableStreamToBytes')]: ['"concat-stream"', '"get-stream"']
  },
  forms: {
    'tanstack-form': [
      '"@hookform/resolvers"',
      '"final-form"',
      '"formik"',
      '"informed"',
      '"react-final-form"',
      '"react-hook-form"'
    ]
  },
  frontend: {
    react: [
      '"@angular',
      '"alpinejs"',
      '"backbone"',
      '"coffeescript"',
      '"inferno"',
      '"lit"',
      '"mithril"',
      '"preact"',
      '"solid-js"',
      '"stimulus"',
      '"svelte"',
      '"vue"'
    ],
    'react + next.js': ['"qwik"']
  },
  hashing: {
    [b('CryptoHasher')]: [
      '"crc"',
      '"crc-32"',
      '"hash-sum"',
      '"hash-wasm"',
      '"js-sha256"',
      '"js-sha3"',
      '"md5"',
      '"md5-file"',
      '"object-hash"',
      '"sha.js"',
      '"spark-md5"',
      '"xxhash-wasm"',
      '"xxhashjs"'
    ]
  },
  http: {
    [w('fetch')]: ['"undici"'],
    [`${w('fetch')} or ky`]: [
      '"axios"',
      '"bent"',
      '"cross-fetch"',
      '"got"',
      '"isomorphic-fetch"',
      '"node-fetch"',
      '"ofetch"',
      '"needle"',
      '"request"',
      '"request-promise"',
      '"superagent"',
      '"wretch"'
    ]
  },
  i18n: {
    'next.js built-in i18n': ['"next-intl"', '"react-i18next"', '"react-intl"'],
    [`next.js built-in i18n or ${w('Intl')}`]: ['"i18next"']
  },
  icons: {
    lucide: [
      '"@fortawesome',
      '"@heroicons',
      '"@iconify',
      '"@tabler/icons-react"',
      '"font-awesome"',
      '"phosphor-react"',
      '"react-icons"'
    ]
  },
  infra: {
    [`${w('Map')} or bun:sqlite`]: ['"keyv"', '"lru-cache"', '"quick-lru"'],
    [`better-auth or ${b('Cookie')}`]: ['"connect-redis"', '"cookie"', '"express-session"'],
    'bun:sqlite': ['"better-sqlite3"'],
    'elysia plugin or platform': ['"@upstash/ratelimit"', '"rate-limiter-flexible"'],
    [`${b('cron')} or platform cron`]: ['"cron"', '"cron-parser"', '"cronstrue"', '"node-cron"'],
    [`${b('redis')} or upstash REST`]: ['"@upstash/redis"', '"ioredis"', '"redis"'],
    [b('s3', 'S3Client')]: ['"@aws-sdk', '"uploadthing"'],
    [`${b('serve')} (WebSocket)`]: ['"ws"'],
    [`${b('sql')} or platform queues`]: ['"bull"', '"bullmq"'],
    'next.js rewrites or elysia': ['"http-proxy"', '"http-proxy-middleware"'],
    'next/image optimization': ['"imagemin"', '"jimp"', '"sharp"'],
    'next/image placeholder=blur': ['"blurhash"', '"plaiceholder"'],
    'not needed with elysia/next.js': [
      '"compression"',
      '"connect"',
      '"finalhandler"',
      '"formidable"',
      '"http-errors"',
      '"on-finished"',
      '"raw-body"',
      '"serve-favicon"',
      '"serve-static"'
    ],
    'platform-managed or error boundary': ['"@sentry'],
    resend: ['"nodemailer"']
  },
  intl: {
    [`${w('Intl')}.NumberFormat`]: ['"accounting"', '"bytes"', '"filesize"', '"numeral"', '"pretty-bytes"'],
    [`${w('Intl')}.PluralRules`]: ['"pluralize"'],
    [`${w('Intl')}.RelativeTimeFormat`]: ['"humanize-duration"', '"ms"', '"timeago.js"']
  },
  logging: {
    lintmax: ['"flow-bin"', '"tslint"'],
    'logtape or consola': [
      '"bunyan"',
      '"debug"',
      '"log4js"',
      '"loglevel"',
      '"npmlog"',
      '"pino"',
      '"roarr"',
      '"signale"',
      '"tslog"',
      '"winston"'
    ]
  },
  markdown: {
    [`${b('markdown')} or remark/rehype`]: [
      '"gray-matter"',
      '"markdown-it"',
      '"marked"',
      '"micromark"',
      '"react-markdown"',
      '"showdown"',
      '"turndown"'
    ]
  },
  metaFramework: {
    'next.js': ['"@sveltejs/kit"', '"astro"', '"blitz"', '"gatsby"', '"nuxt"', '"redwood"', '"remix"'],
    'next.js + turbopack': ['"vite"']
  },
  monorepo: {
    'not needed': [
      '"auto"',
      '"changesets"',
      '"commitlint"',
      '"conventional-changelog"',
      '"release-it"',
      '"semantic-release"',
      '"standard-version"'
    ],
    turbo: ['"lerna"', '"nx"']
  },
  notifications: {
    'shadcn sonner': ['"notistack"', '"react-alert"', '"react-notifications"']
  },
  orm: {
    drizzle: ['"knex"', '"mikro-orm"', '"mongoose"', '"prisma"', '"sequelize"', '"typeorm"']
  },
  parsing: {
    [`DOMParser or bun ${w('HTMLRewriter')}`]: ['"fast-xml-parser"', '"htmlparser2"', '"xml2js"'],
    'bun .env auto-loading': [
      '"dotenv-cli"',
      '"dotenv-defaults"',
      '"dotenv-expand"',
      '"dotenv-flow"',
      '"dotenv-safe"',
      '"env-cmd"',
      '"nconf"'
    ],
    [b('JSON5', 'JSONC')]: ['"comment-json"', '"hjson"', '"json5"', '"jsonc-parser"'],
    [b('JSONL')]: ['"jsonlines"', '"ndjson"'],
    [b('TOML')]: ['"@iarna/toml"', '"smol-toml"', '"toml"'],
    [b('YAML')]: ['"js-yaml"', '"yaml"'],
    [`${b('file')} + string split`]: [
      '"csv-parse"',
      '"csv-stringify"',
      '"fast-csv"',
      '"ini"',
      '"neat-csv"',
      '"papaparse"',
      '"strip-json-comments"'
    ]
  },
  postcss: {
    'tailwind v4 (built-in)': [
      '"autoprefixer"',
      '"postcss-import"',
      '"postcss-modules"',
      '"postcss-nesting"',
      '"postcss-preset-env"'
    ]
  },
  process: {
    [`${w('Promise')}.all or async loops`]: ['"@supercharge/promise-pool"'],
    'bun patch': ['"patch-package"'],
    lintmax: ['"lint-staged"'],
    'not needed with shadcn': ['"storybook"'],
    'process.env.CI': ['"ci-info"', '"is-ci"'],
    'simple-git-hooks': ['"husky"', '"lefthook"', '"pre-commit"'],
    turbo: ['"concurrently"', '"npm-run-all"', '"npm-run-all2"', '"wireit"']
  },
  queue: {
    [b('cron')]: ['"agenda"'],
    [`${b('sql')} or platform queues`]: ['"bee-queue"', '"pg-boss"']
  },
  reactHooks: {
    'React built-ins or es-toolkit': ['"ahooks"', '"react-use"', '"usehooks-ts"']
  },
  reactUtils: {
    'React hooks': ['"react-adopt"', '"react-fns"', '"react-powerplug"', '"react-side-effect"', '"recompose"'],
    'React.lazy or next.js': ['"react-loadable"'],
    TypeScript: ['"create-react-class"', '"prop-types"'],
    'cn() from shadcn': ['"class-variance-authority"', '"classnames"', '"clsx"', '"cva"', '"tailwind-merge"'],
    'native CSS media queries or tailwind breakpoints': ['"react-device-detect"', '"react-media"', '"react-responsive"'],
    'native IntersectionObserver': ['"react-intersection-observer"'],
    'native ResizeObserver': ['"react-measure"', '"react-resize-detector"', '"react-sizes"', '"react-use-measure"'],
    'native loading=lazy or React.lazy': ['"react-lazy-load"', '"react-lazyload"'],
    'navigator.clipboard API': ['"react-copy-to-clipboard"'],
    'next.js': ['"craco"', '"react-app-rewired"', '"react-dev-utils"', '"react-hot-loader"', '"react-scripts"'],
    'next.js metadata': ['"react-document-title"', '"react-helmet"'],
    'next.js routing': ['"@reach/router"', '"@tanstack/react-router"', '"history"', '"react-router"', '"wouter"'],
    'shadcn calendar': ['"react-day-picker"'],
    'shadcn combobox': ['"react-select"'],
    'shadcn command': ['"cmdk"'],
    'shadcn dialog': ['"react-modal"'],
    'shadcn drawer': ['"vaul"'],
    'shadcn or HTML input': ['"react-dropzone"'],
    'shadcn otp': ['"input-otp"'],
    'shadcn pagination': ['"react-paginate"'],
    'shadcn resizable': ['"react-resizable-panels"'],
    'shadcn sonner': ['"react-hot-toast"', '"react-toastify"'],
    'tanstack-query': ['"react-query"', '"swr"']
  },
  realtime: {
    [`${b('serve')} (WebSocket)`]: ['"@stomp/stompjs"', '"ably"', '"pusher"', '"pusher-js"', '"sockjs-client"']
  },
  retry: {
    [w('AbortController')]: ['"p-cancelable"'],
    [`${w('AbortSignal')}.timeout`]: ['"p-timeout"'],
    [`${w('EventTarget')} + ${w('Promise')}`]: ['"p-event"'],
    [`${w('Promise')}.all or async loops`]: [
      '"async"',
      '"async-retry"',
      '"bottleneck"',
      '"p-all"',
      '"p-each-series"',
      '"p-filter"',
      '"p-limit"',
      '"p-map"',
      '"p-map-series"',
      '"p-pipe"',
      '"p-queue"',
      '"p-retry"',
      '"p-forever"',
      '"p-lazy"',
      '"p-min-delay"',
      '"p-props"',
      '"p-series"',
      '"p-times"',
      '"p-try"',
      '"p-waterfall"',
      '"p-whilst"',
      '"exponential-backoff"',
      '"promise-retry"',
      '"retry"'
    ],
    [`${w('Promise')}.allSettled`]: ['"p-reflect"', '"p-settle"'],
    [`${w('Promise')}.any`]: ['"p-any"', '"p-some"'],
    [`${w('Promise')}.race`]: ['"p-race"'],
    'es-toolkit': ['"p-debounce"', '"p-memoize"', '"p-throttle"'],
    [b('sleep')]: ['"delay"']
  },
  routing: {
    [w('URLPattern')]: ['"path-to-regexp"']
  },
  runtime: {
    bun: ['"deno"', '"esno"', '"jiti"', '"module-alias"', '"ts-node"', '"tsconfig-paths"', '"tsx"'],
    'bun --watch': ['"nodemon"', '"onchange"', '"ts-node-dev"', '"tsc-watch"'],
    'bun .env auto-loading': ['"cross-env"', '"dotenv"'],
    'docker or bun --watch': ['"pm2"']
  },
  rxjs: {
    [`${w('EventTarget')} or async iterators`]: [
      '"emittery"',
      '"eventemitter2"',
      '"eventemitter3"',
      '"mitt"',
      '"nanoevents"'
    ],
    [`async iterators or ${w('ReadableStream')}`]: ['"rxjs"']
  },
  sanitize: {
    [b('CSRF')]: ['"csurf"'],
    [b('escapeHTML')]: ['"dompurify"', '"sanitize-html"', '"xss"'],
    zod: ['"validator"']
  },
  shell: {
    [b('$')]: ['"@actions/exec"', '"@npmcli/run-script"', '"execa"', '"open"', '"shelljs"', '"tinyexec"', '"zx"'],
    [b('spawn')]: ['"cross-spawn"', '"pidtree"', '"tree-kill"'],
    [b('which')]: ['"npm-which"', '"which"'],
    [`${n('fs')} watch`]: ['"chokidar"', '"gaze"', '"node-watch"'],
    'process.on exit': ['"signal-exit"']
  },
  state: {
    'zustand or jotai': [
      '"@ngrx/store"',
      '"@preact/signals"',
      '"@reduxjs/toolkit"',
      '"effector"',
      '"immer"',
      '"@legendapp/state"',
      '"mobx"',
      '"nanostores"',
      '"proxy-state-tree"',
      '"recoil"',
      '"redux"',
      '"redux-observable"',
      '"redux-persist"',
      '"redux-saga"',
      '"redux-thunk"',
      '"use-immer"',
      '"valtio"',
      '"xstate"'
    ]
  },
  storage: {
    'upstash REST or platform-managed': ['"@vercel/kv"']
  },
  styling: {
    'React JSX': ['"ejs"', '"handlebars"', '"hbs"', '"mustache"', '"nunjucks"', '"pug"', '"swig"'],
    tailwind: [
      '"@pandacss/dev"',
      '"@stitches',
      '"@stylexjs/stylex"',
      '"css-loader"',
      '"@emotion',
      '"react-css-modules"',
      '"react-jss"',
      '"less"',
      '"linaria"',
      '"sass"',
      '"styled-components"',
      '"stylus"',
      '"twin.macro"',
      '"unocss"',
      '"vanilla-extract"',
      '"windicss"'
    ],
    'tailwind classes': ['"chroma-js"', '"color"', '"color-convert"', '"tinycolor2"']
  },
  table: {
    'tanstack-table': ['"ag-grid"', '"react-table"']
  },
  test: {
    'bun:test': [
      '"@jest',
      '"ava"',
      '"chai"',
      '"expect.js"',
      '"jasmine"',
      '"jest"',
      '"karma"',
      '"mocha"',
      '"power-assert"',
      '"should"',
      '"tap"',
      '"vitest"'
    ],
    'bun:test (coverage built-in)': ['"c8"', '"nyc"'],
    'bun:test (mock built-in)': ['"@faker-js/faker"', '"chance"', '"faker"', '"fetch-mock"', '"msw"', '"nock"', '"sinon"'],
    'bun:test fetch': ['"supertest"'],
    'bun:test mock': ['"proxyquire"', '"rewire"', '"testdouble"']
  },
  tooltip: {
    'cnsync (readonly/ui)': ['"@floating-ui/react"'],
    'shadcn or cnsync': ['"react-popper"'],
    'shadcn tooltip': ['"react-tooltip"', '"tippy.js"']
  },
  types: {
    'TypeScript built-in utility types': [
      '"ts-essentials"',
      '"ts-toolbelt"',
      '"tsutils"',
      '"type-fest"',
      '"utility-types"'
    ]
  },
  utils: {
    'es-toolkit': [
      '"camelcase"',
      '"change-case"',
      '"fast-memoize"',
      '"just-',
      '"micro-memoize"',
      '"deepmerge"',
      '"deepmerge-ts"',
      '"is-plain-object"',
      '"lodash"',
      '"lodash-es"',
      '"memoize-one"',
      '"memoizee"',
      '"radash"',
      '"rambda"',
      '"ramda"',
      '"remeda"',
      '"throttle-debounce"',
      '"underscore"'
    ],
    'es-toolkit or native': ['"fast-levenshtein"', '"leven"', '"natural-compare"'],
    'es-toolkit or regex': ['"slugify"', '"speakingurl"'],
    [b('deepEquals')]: ['"deep-equal"', '"dequal"', '"fast-deep-equal"'],
    [b('inspect')]: ['"object-inspect"'],
    [b('sliceAnsi')]: ['"slice-ansi"'],
    [b('stringWidth')]: ['"string-width"'],
    [b('stripANSI')]: ['"ansi-regex"', '"strip-ansi"'],
    [b('wrapAnsi')]: ['"wrap-ansi"'],
    'literal numbers': ['"http-status-codes"'],
    'native Array.flat': ['"array-flatten"', '"flat"'],
    'native Array.from': ['"arrify"'],
    [`${w('JSON')}.parse`]: ['"destr"'],
    'native Object.hasOwn': ['"has"'],
    [`${w('RegExp')} constructor`]: ['"escape-string-regexp"'],
    [w('URL')]: ['"normalize-url"'],
    [`[...new ${w('Set')}()]`]: ['"array-unique"', '"uniq"'],
    [`${n('net')} createServer`]: ['"detect-port"', '"get-port"', '"portfinder"'],
    'optional chaining': ['"dlv"', '"dot-prop"'],
    'process.env or node:fs check': ['"is-docker"', '"is-wsl"'],
    [w('structuredClone')]: [
      '"circular-json"',
      '"devalue"',
      '"flatted"',
      '"json-stringify-safe"',
      '"serialize-javascript"',
      '"superjson"'
    ],
    [`${w('structuredClone')} or es-toolkit`]: ['"clone"', '"clone-deep"', '"rfdc"'],
    'template literals': ['"common-tags"', '"dedent"', '"endent"', '"outdent"'],
    'throw new Error': ['"invariant"'],
    typeof: ['"is-number"', '"kind-of"']
  },
  validation: {
    zod: [
      '"@sinclair/typebox"',
      '"ajv"',
      '"arktype"',
      '"class-validator"',
      '"fastest-validator"',
      '"io-ts"',
      '"joi"',
      '"ow"',
      '"runtypes"',
      '"superstruct"',
      '"typebox"',
      '"computed-types"',
      '"valibot"',
      '"yup"'
    ]
  },
  versioning: {
    [b('semver')]: ['"compare-versions"', '"node-semver"', '"semver"', '"semver-diff"', '"semver-regex"']
  },
  virtualization: {
    'native scroll or tanstack-virtual': ['"react-virtualized"', '"react-virtuoso"', '"react-window"']
  },
  worker: {
    [w('Worker')]: ['"comlink"', '"piscina"', '"threads"', '"tinypool"', '"worker-threads-pool"', '"workerpool"']
  }
}
const LINTMAX_ONLY_RAW: Record<string, Record<string, string[]>> = {
  linting: {
    lintmax: ['"@biomejs', '"eslint"', '"oxlint"', '"prettier"']
  }
}
const BUN_GLOBALS: Record<string, string> = Object.fromEntries(
  (
    [
      '$',
      'Archive',
      'ArrayBufferSink',
      'CSRF',
      'Cookie',
      'CookieMap',
      'CryptoHasher',
      'FFI',
      'FileSystemRouter',
      'Glob',
      'JSON5',
      'JSONC',
      'JSONL',
      'MD4',
      'MD5',
      'RedisClient',
      'S3Client',
      'SHA1',
      'SHA224',
      'SHA256',
      'SHA384',
      'SHA512',
      'SHA512_256',
      'SQL',
      'TOML',
      'Terminal',
      'Transpiler',
      'YAML',
      'allocUnsafe',
      'argv',
      'build',
      'color',
      'concatArrayBuffers',
      'connect',
      'cron',
      'deepEquals',
      'deepMatch',
      'deflateSync',
      'dns',
      'embeddedFiles',
      'enableANSIColors',
      'env',
      'escapeHTML',
      'fetch',
      'file',
      'fileURLToPath',
      'gc',
      'generateHeapSnapshot',
      'gunzipSync',
      'gzipSync',
      'hash',
      'indexOfLine',
      'inflateSync',
      'inspect',
      'isMainThread',
      'listen',
      'main',
      'markdown',
      'mmap',
      'nanoseconds',
      'openInEditor',
      'password',
      'pathToFileURL',
      'peek',
      'plugin',
      'postgres',
      'randomUUIDv5',
      'randomUUIDv7',
      'readableStreamToArray',
      'readableStreamToArrayBuffer',
      'readableStreamToBlob',
      'readableStreamToBytes',
      'readableStreamToFormData',
      'readableStreamToJSON',
      'readableStreamToText',
      'redis',
      'resolve',
      'resolveSync',
      'revision',
      's3',
      'secrets',
      'semver',
      'serve',
      'sha',
      'shrink',
      'sleep',
      'sleepSync',
      'sliceAnsi',
      'spawn',
      'spawnSync',
      'sql',
      'stderr',
      'stdin',
      'stdout',
      'stringWidth',
      'stripANSI',
      'udpSocket',
      'unsafe',
      'version',
      'which',
      'wrapAnsi',
      'write',
      'zstdCompress',
      'zstdCompressSync',
      'zstdDecompress',
      'zstdDecompressSync'
    ] satisfies BunExport[]
  ).map(name => [`Bun.${name}`, `import { ${name} } from 'bun'`])
)
const TEMPORARY = new Set([
  '"@t3-oss/env',
  '"clsx"',
  '"dotenv-cli"',
  '"ioredis"',
  '"jose"',
  '"postgres"',
  '"q"',
  '"react-dropzone"',
  '"react-intersection-observer"',
  '"sharp"',
  '"slugify"',
  '"tailwind-merge"'
])
const flattenBanned = (dict: Record<string, Record<string, string[]>>): BannedPackage[] =>
  Object.values(dict).flatMap(fixes => Object.entries(fixes).flatMap(([fix, bans]) => bans.map(ban => ({ ban, fix }))))
const ALL_BANNED: BannedPackage[] = flattenBanned(BANNED)
const LINTMAX_ONLY: BannedPackage[] = flattenBanned(LINTMAX_ONLY_RAW)
export { ALL_BANNED, ALLOWED_STACK, BANNED, BUN_GLOBALS, LINTMAX_ONLY, TEMPORARY }
export type { BannedPackage }
