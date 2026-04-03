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

Zero config. The CLI discovers all projects by scanning for `lintmax` in package.json deps via `rg`. It finds the pm4ai and cnsync repos the same way (by package name). If pm4ai or cnsync repos aren't found locally, it clones them to `~/.pm4ai/repos/`. No config files, no registration, no markers.

## Repo structure

```
apps/
  web/                    # fumadocs site — browse rules as docs
    content/
      rules/
        bun.mdx
        typescript.mdx
        nextjs.mdx
        tailwind.mdx
        lintmax.mdx
        testing.mdx
        tsdown.mdx
        ...
    src/
      app/
        docs/             # fumadocs routes
        llms.txt/         # agent-readable
        llms-full.txt/    # agent-readable full
packages/
  pm4ai/                  # CLI engine
    src/
      cli.ts              # entry point
      discover.ts         # rg for lintmax in package.json, auto-clone if needed
      sync.ts             # pull rules + configs + readonly/ui + ci workflow
      audit.ts            # dep checks
      infer.ts            # detect project type + auto-infer CLAUDE.md rules from deps
      maintain.ts         # bun clean && bun i && bun fix
      status.ts           # show status + bun why
      log.ts              # read/write run logs
      swiftbar.ts         # --swiftbar output format
bunfig.toml               # also the template for consumers
.gitignore                # also the template for consumers (includes bun.lock)
turbo.json                # also the template for consumers
tsconfig.json             # also the template for consumers
.github/
  workflows/
    ci.yml                # pm4ai's own CI
```

pm4ai dogfoods its own config files — they ARE the templates copied to consumers.

## CLI

### `pm4ai`

Runs everything in parallel across all discovered projects, streams output as each completes.

1. **Discover** — `rg -l '"lintmax"' ~/ -g 'package.json' -g '!**/node_modules/**'` — find all projects. From results: `"name": "pm4ai"` → source repo, has `readonly/ui` → cnsync. If pm4ai or cnsync not found locally → clone to `~/.pm4ai/repos/`
2. **Git pull all** — fetch + pull every discovered project first (parallel)
3. For each consumer project (parallel):
   a. **Sync configs** — copy from local pm4ai repo:
      - `rules/*.mdx` → infer applicable rules from deps → strip frontmatter, join with `\n---\n\n` → write `CLAUDE.md`
      - Copy verbatim: `bunfig.toml`, `.gitignore`
      - Check exists: `turbo.json`, `tsconfig.json`, `.github/workflows/ci.yml`, `simple-git-hooks` + `prepare` in package.json
   b. **Sync readonly/ui** — copy from local cnsync repo
   d. **Audit**:
      - Scan all `package.json` files in workspace
      - Flag deps not on `"latest"` tag (except intentional pins)
      - Flag duplicate deps across workspace packages
      - Check `packageManager` field — is bun version latest?
      - Check lintmax version — is it latest on npm?
   e. **Maintain**:
      - `bun clean && bun i` — pulls latest lintmax (and all deps)
      - Verify lintmax resolved to actual latest on npm — warn if not
      - `bun fix`
      - Record pass/fail + timestamp to log
4. Print summary + status

### `pm4ai status`

View only, no changes.

1. Discover all projects
2. For each project:
   - Last run: timestamp, pass/fail
   - Last CI: timestamp, pass/fail (GitHub API)
   - Config drift: any files out of sync with source of truth
   - Dep audit: what's not on latest, what's pinned, duplicates
   - `bun why lintmax` — resolved version
   - Bun version vs latest
   - Git status: clean or dirty (uncommitted changes)
   - Git remote: up to date, behind, or ahead of remote (fetch + compare)
3. `--swiftbar` flag: output in SwiftBar plugin format

## SwiftBar integration

`pm4ai status --swiftbar` outputs SwiftBar-compatible text:

- Menubar icon: green checkmark or red X
- Dropdown: per-project status with last run time
- Refresh interval configured by plugin filename (e.g. `pm4ai.1h.sh`)

Plugin file is just:

```sh
#!/bin/bash
pm4ai status --swiftbar
```

## Rules (CLAUDE.md generation)

Each `.mdx` file in `apps/web/content/rules/` is a topic. Frontmatter has title and description for the docs site. The body content (minus frontmatter) gets concatenated into CLAUDE.md.

Rules are selectively merged per project, fully auto-inferred:
- **Always included**: `bun`, `typescript` (every project is bun + TS)
- **Auto-inferred from deps**: `next` in deps → `nextjs` rule, `tailwindcss` → `tailwind`, `playwright` → `testing`, `lintmax` → `lintmax`, `tsdown` → `tsdown`

No config file needed. pm4ai reads each project's package.json to determine which rules apply.

## What pm4ai syncs

**Copy verbatim** (identical across all projects):

| What | Source |
|------|--------|
| CLAUDE.md | pm4ai repo `rules/` — assemble from inferred topics |
| bunfig.toml | pm4ai repo root |
| .gitignore | pm4ai repo root |

**Check if exists, warn if missing** (project-specific content):

| What | What to check |
|------|---------------|
| .github/workflows/ci.yml | exists, runs `bun clean && bun i && bun fix` |
| turbo.json | exists |
| tsconfig.json | exists, extends `lintmax/tsconfig` |
| vercel.json | exists (only if project has next.config.ts) |
| `simple-git-hooks` in package.json | field exists with pre-commit hook |
| `prepare` script in package.json | exists, runs `bunx simple-git-hooks` |
| `readonly/ui` directory | exists |
| `packageManager` in package.json | exists, bun version is latest |
| lintmax in deps | exists, resolved version is latest |

## What pm4ai audits

- All deps have `"latest"` tag (flag exceptions)
- No duplicate deps across workspace packages
- Pinned deps — try bumping to latest in a temp branch, run `bun clean && bun i && bun fix`, report if it passes or what breaks
- `packageManager` bun version is latest release (checked via GitHub API, can't use `"latest"` tag for bun)
- lintmax resolved version matches latest on npm
- CI status via GitHub API
- Project type inference: has `next.config.ts` → web app, has `exports` in package.json → library, both → both

## What pm4ai maintains

Per project:

```sh
bun clean && bun i && bun fix
```

Results logged with timestamp. Failures reported with error output.

## bun.lock snapshots

For production systems, pm4ai saves a copy of `bun.lock` after each successful maintenance run to `~/.pm4ai/snapshots/<project-name>/bun.lock` (latest only, no history). This allows quick rollback when a new dep version breaks production — copy the snapshot back, `bun i --frozen-lockfile`.

## Periodic auto-run

pm4ai installs a launchd plist (macOS) to run `pm4ai` on a schedule (e.g. daily). This catches upstream breakage early without manual intervention. The SwiftBar plugin shows the result — you just glance at the menubar.

## Enforced rules

pm4ai enforces these across all projects:
- Never `bun update` — only `bun clean && bun i`
- All deps on `"latest"` unless explicitly pinned
- `simple-git-hooks` with `pre-commit: "bun run verify && git add -u"`
- `prepare` script: `bunx simple-git-hooks`
- `readonly/ui` as the standard component library path (migrate `lib/ui` variants)
- No lockfile committed (`bun.lock` in `.gitignore`)
- GitHub Actions CI workflow reproduces the same `bun clean && bun i && bun fix` pattern
- `tsdown` for library publishing when project has publishable packages

## Implementation phases

### Phase 1 — Repo scaffold
- Turborepo monorepo with `packages/pm4ai` and `apps/web`
- Root configs (dogfooded)
- Package.json with bin entry
- Basic tsconfig, bunfig, gitignore

### Phase 2 — CLI core
- `discover.ts` — find projects via rg, identify pm4ai/cnsync repos, auto-clone if missing
- `log.ts` — JSON log read/write (~/.pm4ai/log.json)
- `cli.ts` — arg parsing, command routing

### Phase 3 — Sync engine
- Find pm4ai and cnsync repos locally via rg (same discovery as CLI core)
- Copy rules from local pm4ai repo, infer applicable rules, assemble CLAUDE.md
- Copy config files from local pm4ai repo to consumers
- Copy readonly/ui from local cnsync repo

### Phase 4 — Audit
- Scan package.json files
- Check latest tags, duplicates, pins
- Check bun version via GitHub API
- Check lintmax version via npm registry

### Phase 5 — Maintain
- Run `bun clean && bun i && bun fix` per project
- Parallel execution with streamed output
- Log results

### Phase 6 — Status
- Read logs, query GitHub CI status
- Terminal formatted output
- `--swiftbar` flag

### Phase 7 — Fumadocs site
- Rules as MDX content
- Browse and search rules
- llms.txt routes

### Phase 8 — Rules content
- Extract common patterns from existing CLAUDE.md files
- Write all rule topics as mdx files
