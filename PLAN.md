# pm4ai

Super opinionated project manager that keeps all your TypeScript projects in sync.

One source of truth. Zero manual maintenance.

## Philosophy

- Everything on `"latest"` tag by default to catch upstream changes early
- Never `bun update` (it replaces `"latest"` with resolved versions) — always `bun clean && bun i`
- Precommit and CI are robust guards, so upstream breakage is caught immediately
- For production systems, keep bun.lock snapshots in a separate place for easy rollback
- For deps that must be pinned, pin major version only (e.g. `"eslint": "9"`)
- A project can be a web app, a library, or both — inferred from configs, never declared manually
- `bun fix` means lintmax fix + build everything — verify deps work, not just lint

## Architecture

- **npm package** (`pm4ai`) — CLI engine, published to npm, run via `bunx pm4ai@latest`
- **pm4ai repo** — source of truth for rules, configs, and the docs site
- **cnsync repo** — source of truth for `readonly/ui`
- **Consumer projects** — any project with `lintmax` in package.json deps (zero config)

Zero config. The CLI discovers all projects by scanning for `lintmax` in package.json deps via `rg`. It finds the pm4ai and cnsync repos the same way (by package name). If pm4ai or cnsync repos aren’t found locally, it clones them to `~/.pm4ai/repos/`. No config files, no registration, no markers.

## Repo structure

```
apps/
  web/                    # fumadocs site — browse rules as docs
    content/
      rules/
        general.mdx           # always, first — CLAUDE.md is generated, never edit; use companion files
        bun.mdx              # always
        typescript.mdx        # always
        code-quality.mdx      # always
        lintmax.mdx           # always
        git.mdx               # always
        react-nextjs.mdx      # has next
        minimal-dom.mdx       # has tailwindcss
        shadcn.mdx            # has tailwindcss
        testing.mdx           # has playwright
        tsdown.mdx            # has tsdown
    src/
      app/
        docs/             # fumadocs routes
        llms.txt/         # agent-readable
        llms-full.txt/    # agent-readable full
packages/
  pm4ai/                  # CLI engine
    src/
      cli.ts              # entry point
      guide.ts            # the guide text — single source for docs + llms.txt
      discover.ts         # rg for lintmax in package.json, auto-clone if needed
      sync.ts             # pull rules + configs + readonly/ui + ci workflow
      audit.ts            # dep checks
      infer.ts            # detect project type + auto-infer CLAUDE.md rules from deps
      maintain.ts         # runs sh up.sh per project
      status.ts           # show status + bun why
      log.ts              # read/write run logs
      swiftbar.ts         # --swiftbar output format
clean.sh                  # copied to consumers — nuke all artifacts
up.sh                     # copied to consumers — clean.sh + install + fix + check
bunfig.toml               # copied to consumers
.gitignore                # copied to consumers (includes bun.lock)
.github/
  workflows/
    ci.yml                # pm4ai's own CI
```

pm4ai dogfoods its own config files — they ARE the templates copied to consumers.

## CLI

Agent-first. Output is self-documenting plain text. No `--help` flag — the default command IS the guide.

### `pm4ai`

Prints the guide — the single source of truth for all documentation:

```
pm4ai — zero-config project manager for TypeScript monorepos

discovers projects by scanning for lintmax in package.json deps
discovers itself and cnsync the same way (auto-clones if not found)

commands:
  pm4ai          this guide
  pm4ai status   view issues across all projects (no changes)
  pm4ai fix      sync configs + pull latest deps + lint/build check

status output format (only issues shown, healthy = no output):
  /path/to/project
    bun 1.3.11 behind latest 1.3.14
    file clean.sh out of sync
    git 3 commits behind remote
    lintmax 0.1.2 behind latest 0.1.3
    dep react not on latest tag
    up.sh failed: next build error
    ci failed 2026-04-02

flags:
  --swiftbar     output in SwiftBar menubar format

synced files (copied verbatim from pm4ai repo):
  clean.sh  up.sh  bunfig.toml  .gitignore  CLAUDE.md (generated from rules)

checked files (warn if missing):
  turbo.json  tsconfig.json  .github/workflows/ci.yml
  simple-git-hooks + prepare script in package.json
```

The fumadocs `llms.txt` route imports and serves this same text. One source, zero duplication.

### `pm4ai status`

View only, no changes. Discovers all projects, reports issues.

1. **Discover** — `rg -l '"lintmax"' ~/ -g 'package.json' -g '!**/node_modules/**'` — find all projects. `"name": "pm4ai"` → source repo, has `readonly/ui` → cnsync. If pm4ai or cnsync not found locally → clone to `~/.pm4ai/repos/`
2. For each project (parallel):
   - Git: dirty (uncommitted changes), behind/ahead of remote
   - Config drift: `clean.sh`, `up.sh`, `bunfig.toml`, `.gitignore`, `CLAUDE.md` out of sync
   - Missing: `turbo.json`, `tsconfig.json`, `.github/workflows/ci.yml`, `simple-git-hooks`, `prepare` script
   - Deps: not on `"latest"` tag, duplicates across workspace packages
   - Versions: bun version vs latest, lintmax resolved vs latest on npm
   - Last `up.sh` run: timestamp, pass/fail
   - Last CI: timestamp, pass/fail (GitHub API)
3. Output only issues — no output for healthy projects
4. `--swiftbar` flag: output in SwiftBar format for menubar

Output format (self-explanatory, no docs needed):

```
/Users/o/z/cnsync
  bun 1.3.11 behind latest 1.3.14
  file clean.sh out of sync
  git 3 commits behind remote

/Users/o/z/ogrid
  up.sh failed: next build error
```

### `pm4ai fix`

Sync + audit + maintain. Streams output as each project completes (parallel).

1. **Discover** — same as status
2. **Git pull all** — fetch + pull every discovered project first (parallel, skip if dirty)
3. For each consumer project (parallel): a. **Sync** — from local pm4ai repo:
   - `rules/*.mdx` → infer applicable rules from deps → strip frontmatter, join with `\n---\n\n` → write `CLAUDE.md`
   - Copy verbatim: `clean.sh`, `up.sh`, `bunfig.toml`, `.gitignore` b. **Sync readonly/ui** — copy from local cnsync repo c. **Maintain**:
   - `sh up.sh` — cleans, installs fresh (pulls latest deps), fixes, checks
   - Verify lintmax resolved to actual latest on npm — warn if not
   - Record pass/fail + timestamp to log
4. Output remaining issues (same format as status)

## SwiftBar integration

`pm4ai status --swiftbar` outputs SwiftBar-compatible text using the BitBar plugin protocol:

- Line 1 (menubar): green checkmark (`sfimage=checkmark.circle.fill sfcolor=green`) or red X (`sfimage=xmark.circle.fill sfcolor=red`)
- After `---`: per-project status as dropdown items
- Healthy projects: `ProjectName | sfimage=checkmark.circle sfcolor=green`
- Unhealthy projects: `ProjectName | sfimage=xmark.circle sfcolor=red` with `--issue detail` submenus
- Click project → opens terminal at project path (`bash=/bin/zsh param1=-c param2='cd /path && exec zsh' terminal=true`)
- Refresh interval configured by plugin filename (e.g. `pm4ai.1h.sh` = every hour)

Plugin file (`~/.config/swiftbar/pm4ai.1h.sh`):

```sh
#!/bin/bash
bunx pm4ai@latest status --swiftbar
```

## Rules (CLAUDE.md generation)

Each `.mdx` file in `apps/web/content/rules/` is a topic. Frontmatter has title and description for the docs site. The body content (minus frontmatter) gets concatenated into CLAUDE.md.

Rules are selectively merged per project, fully auto-inferred from deps:

**Always included** (every project is bun + TS):

- `general.mdx` — CLAUDE.md is auto-generated by pm4ai, never edit it. Use companion files: LEARNING.md (gotchas, known issues), RULES.md (project-specific rules), PROGRESS.md (ongoing work), PLAN.md (architecture decisions)
- `bun.mdx` — bun only, never yarn/npm, clean && install pattern, q wrapper, silent success/verbose failure
- `typescript.mdx` — arrow functions only, exports at end, exhaustive switch, max 3 args, explicit imports, for loops
- `code-quality.mdx` — no comments, no any/!, no ts-ignore, single source of truth, consolidation checklist
- `lintmax.mdx` — ignore syntax table, ignore strategy, cross-linter rules, safe-to-ignore rules
- `git.mdx` — small frequent commits, no AI mentions

**Auto-inferred from deps**:

- `next` → `react-nextjs.mdx` — server components by default, use client only when needed
- `tailwindcss` → `minimal-dom.mdx` — fewest nodes, gap/space/divide before wrappers, review checklist
- `tailwindcss` → `shadcn.mdx` — use as-is, semantic colors, cn() for conditionals
- `playwright` → `testing.mdx` — testing conventions
- `tsdown` → `tsdown.mdx` — library publishing conventions

No config file needed. pm4ai reads each project’s package.json to determine which rules apply.

### CLAUDE.md and companion files

pm4ai fully owns `CLAUDE.md` — it’s entirely generated from rules, no project-specific content mixed in.

Project-specific content goes into companion files (standard across all projects):

- `LEARNING.md` — lessons learned, gotchas, known issues
- `RULES.md` — project-specific rules that don’t apply to other projects
- `PROGRESS.md` — tracking ongoing work
- `PLAN.md` — planning and architecture decisions

pm4ai checks that these files exist (warn if missing) but never writes to them — they are human/agent-maintained per project.

## What pm4ai syncs

**Copy verbatim** (identical across all projects):

| What        | Source                                              |
| ----------- | --------------------------------------------------- |
| CLAUDE.md   | pm4ai repo `rules/` — assemble from inferred topics |
| clean.sh    | pm4ai repo root                                     |
| up.sh       | pm4ai repo root                                     |
| bunfig.toml | pm4ai repo root                                     |
| .gitignore  | pm4ai repo root                                     |

**Check if exists, warn if missing** (project-specific content):

| What                               | What to check                               |
| ---------------------------------- | ------------------------------------------- |
| .github/workflows/ci.yml           | exists, runs `sh up.sh`                     |
| turbo.json                         | exists                                      |
| tsconfig.json                      | exists, extends `lintmax/tsconfig`          |
| vercel.json                        | exists (only if project has next.config.ts) |
| `simple-git-hooks` in package.json | field exists with pre-commit hook           |
| `prepare` script in package.json   | exists, runs `bunx simple-git-hooks`        |
| `readonly/ui` directory            | exists                                      |
| `LEARNING.md`                      | exists                                      |
| `RULES.md`                         | exists                                      |
| `PROGRESS.md`                      | exists                                      |
| `PLAN.md`                          | exists                                      |
| `packageManager` in package.json   | exists, bun version is latest               |
| lintmax in deps                    | exists, resolved version is latest          |

## What pm4ai audits

- All deps have `"latest"` tag (flag exceptions)
- No duplicate deps across workspace packages
- Pinned deps — try bumping to latest in a temp branch, run `sh up.sh`, report if it passes or what breaks
- `packageManager` bun version is latest release (checked via GitHub API, can’t use `"latest"` tag for bun)
- lintmax resolved version matches latest on npm
- CI status via GitHub API

## What pm4ai maintains

Per project, runs `sh up.sh`:

```sh
# clean.sh
rm -rf node_modules bun.lock .cache .turbo **/node_modules **/.cache **/.next **/.turbo **/dist

# up.sh
sh clean.sh && bun i --ignore-scripts && bunx simple-git-hooks && bun run fix && bun run check
```

Each project’s `fix` and `check` scripts in package.json handle project-specific behavior (e.g. `lintmax fix && turbo build`).

Results logged with timestamp. Failures reported with error output.

## bun.lock snapshots

For production systems, pm4ai saves a copy of `bun.lock` after each successful maintenance run to `~/.pm4ai/snapshots/<project-name>/bun.lock` (latest only, no history). This allows quick rollback when a new dep version breaks production — copy the snapshot back, `bun i --frozen-lockfile`.

## Periodic auto-run

pm4ai installs a launchd user agent (`~/Library/LaunchAgents/com.pm4ai.fix.plist`) to run `bunx pm4ai@latest fix` daily. Requires full PATH to bun in the plist since launchd doesn’t source shell profile.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pm4ai.fix</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/o/.bun/bin/bunx</string>
        <string>pm4ai@latest</string>
        <string>fix</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/Users/o/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/pm4ai.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/pm4ai.stderr.log</string>
</dict>
</plist>
```

Load with `launchctl load ~/Library/LaunchAgents/com.pm4ai.fix.plist`. SwiftBar plugin shows the result — just glance at the menubar.

## Enforced rules

pm4ai enforces these across all projects:

- Never `bun update` — only `bun clean && bun i`
- All deps on `"latest"` unless explicitly pinned
- `simple-git-hooks` with `pre-commit: "sh up.sh && git add -u"`
- `prepare` script: `bunx simple-git-hooks`
- `readonly/ui` as the standard component library path (migrate `lib/ui` variants)
- No lockfile committed (`bun.lock` in `.gitignore`)
- GitHub Actions CI workflow runs `sh up.sh`
- `tsdown` for library publishing when project has publishable packages

## Implementation phases

### Phase 1 — Repo scaffold + rules content

- Turborepo monorepo with `packages/pm4ai` and `apps/web`
- Root configs (dogfooded): `bunfig.toml`, `.gitignore`, `turbo.json`, `tsconfig.json`, `clean.sh`, `up.sh`
- Package.json with bin entry, `packageManager`, `simple-git-hooks`, `prepare`
- `.github/workflows/ci.yml`
- Write all rule topic MDX files extracted from existing ogrid/noboil CLAUDE.md files
- Fumadocs app scaffold with rules as content

### Phase 2 — CLI core + discovery

- `guide.ts` — the guide text (single source of truth for all docs)
- `cli.ts` — arg parsing (`pm4ai`, `pm4ai status`, `pm4ai fix`, `--swiftbar`)
- `discover.ts` — `rg` for lintmax in package.json, identify self/cnsync, auto-clone if missing
- `log.ts` — read/write `~/.pm4ai/log.json`

### Phase 3 — Status + audit

- `status.ts` — git status, config drift (file comparison), dep audit, version checks
- `audit.ts` — latest tags, duplicates, pinned deps, bun version (GitHub API), lintmax version (npm registry)
- `infer.ts` — detect project type + infer CLAUDE.md rules from deps
- Output format: issues only, self-documenting plain text
- `swiftbar.ts` — `--swiftbar` flag output

### Phase 4 — Fix (sync + maintain)

- `sync.ts` — copy verbatim files, assemble CLAUDE.md from inferred rules, copy readonly/ui
- `maintain.ts` — git pull, `sh up.sh`, verify lintmax version, log results
- Parallel execution with streamed output per project

### Phase 5 — Fumadocs site

- Rules rendered as docs (already have MDX from phase 1)
- `llms.txt` route imports guide text from CLI package
- Browse and search rules

### Phase 6 — Periodic + SwiftBar

- Generate launchd plist for daily auto-run
- SwiftBar plugin file generation
- Setup instructions in guide
