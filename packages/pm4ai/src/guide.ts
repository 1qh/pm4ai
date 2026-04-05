export const guide = `pm4ai — agent-first anti-slop project management for TypeScript monorepos
discovers projects by scanning for lintmax in package.json deps
discovers itself and cnsync the same way (auto-clones if not found)
context-aware: inside a project, operates on that project only
commands:
  pm4ai            this guide
  pm4ai status     check current project (or all if outside a project)
  pm4ai fix        sync + maintain current project (requires clean git)
  pm4ai init <n>   scaffold a new pm4ai-ready project
  pm4ai watch      live terminal dashboard (connects to running fix/status)
  pm4ai dashboard  local web dashboard at http://localhost:4200
  pm4ai setup      install swiftbar menubar plugin + launchd daily auto-run
flags:
  --all            force global scan across all projects
  --swiftbar       output in SwiftBar menubar format
  --json           (watch) output raw newline-delimited JSON events
  --verbose        print debug info to stderr
fix behavior:
  blocks if git is dirty, behind remote, or ahead (unpushed)
  syncs: clean.sh, up.sh, bunfig.toml, .gitignore, CLAUDE.md, readonly/ui
  maintains: runs sh up.sh (clean + install + build + fix + check)
  shows file change summary after completion
status output (only issues shown, healthy projects omitted):
  /path/to/project
    git 3 commits behind remote
    file clean.sh out of sync
    missing turbo.json
    drift clean should start with "sh clean.sh"
    dep react should be "latest" or "^major"
    duplicate ai already provided by workspace dep
    forbidden npm found, use bun only
    ci failed 2026-04-02
    deploy vercel deployment failed
    check failed 5m ago (current), 15 violations
    check passed 0m ago (current)
checks:
  git status, behind/ahead remote
  config drift (synced files match source)
  missing infra (turbo.json, tsconfig.json, ci.yml)
  root package.json (private, packageManager, hooks, sherif, prepare, clean)
  tsconfig extends lintmax/tsconfig
  vercel.json installCommand is bun i
  vercel deployment status
  deps on latest or ^major, no duplicates across workspaces
  no npm/yarn/pnpm in scripts or lockfiles
  turbo scripts have --output-logs=errors-only
  published packages have type:module, exports, files, license, repository
  workspace devDependencies hoisted to root
  no nested .gitignore, no postcss.config.mjs, no @ts-nocheck
  no bun.lock tracked in git, no redundant clean scripts in sub-packages
  ci status via github api
  background lint check with commit-aware staleness detection`
