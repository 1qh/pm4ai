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
      '"babel-plugin-transform"',
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
    'ink or import { $ } from bun': ['"clipboardy"'],
    'ink or import { color } from bun': [
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
    'native AbortController': ['"abortcontroller-polyfill"'],
    'native Blob': ['"cross-blob"', '"fetch-blob"'],
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
    'native FormData': ['"form-data"', '"formdata-node"'],
    'native Promise': ['"any-promise"', '"bluebird"', '"lie"', '"pinkie"', '"q"', '"rsvp"'],
    'native ReadableStream': ['"web-streams-polyfill"'],
    'native URL API': ['"whatwg-url"'],
    'native fetch': ['"whatwg-fetch"'],
    'node:path': ['"path-browserify"'],
    'node:stream': ['"readable-stream"', '"stream-browserify"'],
    'node:util promisify or node:fs/promises': ['"mz"', '"pify"', '"thenify"']
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
    'import { Archive } from bun': ['"archiver"', '"tar"', '"tar-fs"', '"tar-stream"'],
    'import { gzipSync, deflateSync } from bun': ['"adm-zip"', '"fflate"', '"jszip"', '"lz-string"', '"pako"']
  },
  config: {
    'bun .env auto-loading': ['"convict"'],
    'import { file } from bun': ['"conf"', '"configstore"', '"cosmiconfig"'],
    'zod + bun .env auto-loading': ['"@t3-oss/env"', '"envalid"']
  },
  crypto: {
    'crypto.randomUUID()': [
      '"cuid"',
      '"cuid2"',
      '"flake-idgen"',
      '"hyperid"',
      '"ksuid"',
      '"nanoid"',
      '"short-uuid"',
      '"ulid"',
      '"uuid"',
      '"xid"'
    ],
    'import { password } from bun': ['"argon2"', '"bcrypt"', '"bcryptjs"', '"scrypt-js"'],
    'native Web Crypto API': ['"crypto-js"', '"node-forge"', '"node-rsa"', '"tweetnacl"']
  },
  date: {
    'date-fns': ['"dayjs"', '"luxon"', '"moment"', '"moment-timezone"']
  },
  dbDrivers: {
    drizzle: ['"mongodb"'],
    'drizzle or import { sql } from bun': [
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
    'bun:test + playwright': [
      '"@testing-library/react"',
      '"@testing-library/user-event"',
      '"enzyme"',
      '"react-test-renderer"',
      '"testing-library"'
    ],
    playwright: ['"cheerio"', '"cypress"', '"nightwatch"', '"puppeteer"', '"selenium"', '"webdriver"']
  },
  email: {
    resend: ['"@sendgrid/mail"', '"mailgun.js"', '"postmark"']
  },
  encoding: {
    'import { escapeHTML } from bun': ['"entities"', '"escape-html"', '"he"'],
    'native Response headers or elysia': ['"content-type"', '"mime"', '"mime-types"'],
    'native TextDecoder': ['"iconv-lite"'],
    'native URL API': ['"url"', '"url-parse"'],
    'native URLSearchParams': ['"qs"', '"query-string"', '"querystring"'],
    'native btoa/atob': ['"base64-js"', '"js-base64"']
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
    'import { Glob } from bun': [
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
    'import { Glob } from bun or node:fs walk': ['"find-up"', '"pkg-dir"'],
    'import.meta.resolve': ['"resolve"', '"resolve-from"'],
    'node:fs': [
      '"cpy"',
      '"fs-extra"',
      '"graceful-fs"',
      '"load-json-file"',
      '"ncp"',
      '"proper-lockfile"',
      '"write-file-atomic"',
      '"write-json-file"'
    ],
    'node:fs mkdir recursive': ['"make-dir"', '"mkdirp"'],
    'node:fs or import { $ } from bun': ['"del"', '"rimraf"'],
    'node:os tmpdir + node:fs': ['"tmp"', '"tmp-promise"'],
    'node:path': ['"normalize-path"'],
    'node:path/posix': ['"slash"'],
    'readableStreamToText/Bytes from bun': ['"concat-stream"', '"get-stream"']
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
    'import { CryptoHasher } from bun': [
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
    fetch: ['"undici"'],
    'fetch or ky': [
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
    'next.js built-in i18n or native Intl': ['"i18next"']
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
    'Map or bun:sqlite': ['"keyv"', '"lru-cache"', '"quick-lru"'],
    'better-auth or import { Cookie } from bun': ['"connect-redis"', '"cookie"', '"express-session"'],
    'bun:sqlite': ['"better-sqlite3"'],
    'elysia plugin or platform': ['"@upstash/ratelimit"', '"rate-limiter-flexible"'],
    'import { cron } from bun or platform cron': ['"cron"', '"cron-parser"', '"cronstrue"', '"node-cron"'],
    'import { redis } from bun or upstash REST': ['"@upstash/redis"', '"ioredis"', '"redis"'],
    'import { s3, S3Client } from bun': ['"@aws-sdk', '"uploadthing"'],
    'import { serve } from bun (WebSocket)': ['"ws"'],
    'import { sql } from bun or platform queues': ['"bull"', '"bullmq"'],
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
    'Intl.NumberFormat': ['"accounting"', '"bytes"', '"filesize"', '"numeral"', '"pretty-bytes"'],
    'Intl.PluralRules': ['"pluralize"'],
    'Intl.RelativeTimeFormat': ['"humanize-duration"', '"ms"', '"timeago.js"']
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
    'import { markdown } from bun or remark/rehype': [
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
    'next.js': ['"astro"', '"blitz"', '"gatsby"', '"nuxt"', '"redwood"', '"remix"', '"sveltekit"'],
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
    'DOMParser or bun HTMLRewriter': ['"fast-xml-parser"', '"htmlparser2"', '"xml2js"'],
    'bun .env auto-loading': [
      '"dotenv-cli"',
      '"dotenv-defaults"',
      '"dotenv-expand"',
      '"dotenv-flow"',
      '"dotenv-safe"',
      '"env-cmd"',
      '"nconf"'
    ],
    'import { JSON5, JSONC } from bun': ['"comment-json"', '"hjson"', '"json5"', '"jsonc-parser"'],
    'import { JSONL } from bun': ['"jsonlines"', '"ndjson"'],
    'import { TOML } from bun': ['"@iarna/toml"', '"smol-toml"', '"toml"'],
    'import { YAML } from bun': ['"js-yaml"', '"yaml"'],
    'import { file } from bun + string split': [
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
    'Promise.all or async loops': ['"@supercharge/promise-pool"'],
    'bun patch': ['"patch-package"'],
    lintmax: ['"lint-staged"'],
    'not needed with shadcn': ['"storybook"'],
    'process.env.CI': ['"ci-info"', '"is-ci"'],
    'simple-git-hooks': ['"husky"', '"lefthook"', '"pre-commit"'],
    turbo: ['"concurrently"', '"npm-run-all"', '"npm-run-all2"', '"wireit"']
  },
  queue: {
    'import { cron } from bun': ['"agenda"'],
    'import { sql } from bun or platform queues': ['"bee-queue"', '"pg-boss"']
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
    'next.js error.tsx': ['"react-error-boundary"'],
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
    'import { serve } from bun (WebSocket)': ['"@stomp/stompjs"', '"ably"', '"pusher"', '"pusher-js"', '"sockjs-client"']
  },
  retry: {
    AbortController: ['"p-cancelable"'],
    'AbortSignal.timeout': ['"p-timeout"'],
    'EventTarget + Promise': ['"p-event"'],
    'Promise.all or async loops': [
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
    'Promise.allSettled': ['"p-reflect"', '"p-settle"'],
    'Promise.any': ['"p-any"', '"p-some"'],
    'Promise.race': ['"p-race"'],
    'es-toolkit': ['"p-debounce"', '"p-memoize"', '"p-throttle"'],
    'import { sleep } from bun': ['"delay"']
  },
  routing: {
    'URLPattern API': ['"path-to-regexp"']
  },
  runtime: {
    bun: ['"deno"', '"esno"', '"jiti"', '"module-alias"', '"ts-node"', '"tsconfig-paths"', '"tsx"'],
    'bun --watch': ['"nodemon"', '"onchange"', '"ts-node-dev"', '"tsc-watch"'],
    'bun .env auto-loading': ['"cross-env"', '"dotenv"'],
    'docker or bun --watch': ['"pm2"']
  },
  rxjs: {
    'EventTarget or async iterators': ['"emittery"', '"eventemitter2"', '"eventemitter3"', '"mitt"', '"nanoevents"'],
    'async iterators or ReadableStream': ['"rxjs"']
  },
  sanitize: {
    'import { CSRF } from bun': ['"csurf"'],
    'import { escapeHTML } from bun': ['"dompurify"', '"sanitize-html"', '"xss"'],
    zod: ['"validator"']
  },
  shell: {
    'import { $ } from bun': [
      '"@actions/exec"',
      '"@npmcli/run-script"',
      '"execa"',
      '"open"',
      '"shelljs"',
      '"tinyexec"',
      '"zx"'
    ],
    'import { spawn } from bun': ['"cross-spawn"', '"pidtree"', '"tree-kill"'],
    'import { which } from bun': ['"npm-which"', '"which"'],
    'node:fs watch': ['"chokidar"', '"gaze"', '"node-watch"'],
    'process.on exit': ['"signal-exit"']
  },
  state: {
    'zustand or jotai': [
      '"@ngrx/store"',
      '"@preact/signals"',
      '"@reduxjs/toolkit"',
      '"effector"',
      '"immer"',
      '"legend-state"',
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
      '"windi-css"'
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
    'import { deepEquals } from bun': ['"deep-equal"', '"dequal"', '"fast-deep-equal"'],
    'import { inspect } from bun': ['"object-inspect"'],
    'import { sliceAnsi } from bun': ['"slice-ansi"'],
    'import { stringWidth } from bun': ['"string-width"'],
    'import { stripANSI } from bun': ['"ansi-regex"', '"strip-ansi"'],
    'import { wrapAnsi } from bun': ['"wrap-ansi"'],
    'literal numbers': ['"http-status-codes"'],
    'native Array.flat': ['"array-flatten"', '"flat"'],
    'native Array.from': ['"arrify"'],
    'native JSON.parse': ['"destr"'],
    'native Object.hasOwn': ['"has"'],
    'native RegExp constructor': ['"escape-string-regexp"'],
    'native URL API': ['"normalize-url"'],
    'native [...new Set()]': ['"array-unique"', '"uniq"'],
    'native net.createServer': ['"detect-port"', '"get-port"', '"portfinder"'],
    'optional chaining': ['"dlv"', '"dot-prop"'],
    'process.env or node:fs check': ['"is-docker"', '"is-wsl"'],
    structuredClone: [
      '"circular-json"',
      '"devalue"',
      '"flatted"',
      '"json-stringify-safe"',
      '"serialize-javascript"',
      '"superjson"'
    ],
    'structuredClone or es-toolkit': ['"clone"', '"clone-deep"', '"rfdc"'],
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
    'import { semver } from bun': ['"compare-versions"', '"node-semver"', '"semver"', '"semver-diff"', '"semver-regex"']
  },
  virtualization: {
    'native scroll or tanstack-virtual': ['"react-virtualized"', '"react-virtuoso"', '"react-window"']
  },
  worker: {
    'native Worker API': ['"comlink"', '"piscina"', '"threads"', '"tinypool"', '"worker-threads-pool"', '"workerpool"']
  }
}
const LINTMAX_ONLY_RAW: Record<string, Record<string, string[]>> = {
  linting: {
    lintmax: ['"@biomejs', '"eslint"', '"oxlint"', '"prettier"']
  }
}
const flattenBanned = (dict: Record<string, Record<string, string[]>>): BannedPackage[] =>
  Object.values(dict).flatMap(fixes => Object.entries(fixes).flatMap(([fix, bans]) => bans.map(ban => ({ ban, fix }))))
const ALL_BANNED: BannedPackage[] = flattenBanned(BANNED)
const LINTMAX_ONLY: BannedPackage[] = flattenBanned(LINTMAX_ONLY_RAW)
export { ALL_BANNED, ALLOWED_STACK, BANNED, LINTMAX_ONLY }
export type { BannedPackage }
