export const guide = `pm4ai — zero-config project manager for TypeScript monorepos
discovers projects by scanning for lintmax in package.json deps
discovers itself and cnsync the same way (auto-clones if not found)
commands:
  pm4ai          this guide
  pm4ai status   check current project (or all if outside a project)
  pm4ai fix      sync + maintain current project (or all if outside)
  --all          force global scan across all projects
  pm4ai init <n>  scaffold a new pm4ai-ready project, then run pm4ai fix
  pm4ai setup    install swiftbar plugin + launchd daily auto-run
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
flags:
  --swiftbar     output in SwiftBar menubar format
  --verbose      print debug info to stderr
synced files (copied verbatim from pm4ai repo):
  clean.sh  up.sh  bunfig.toml  .gitignore  CLAUDE.md (generated from rules)
checks:
  git status, behind/ahead remote
  config drift (synced files match source)
  missing infra (turbo.json, tsconfig.json, ci.yml)
  root package.json (private, packageManager, hooks, sherif, prepare, clean)
  tsconfig extends lintmax/tsconfig
  vercel.json installCommand is bun i
  deps on latest or ^major, no duplicates across workspaces
  no npm/yarn/pnpm in scripts or lockfiles
  turbo scripts have --output-logs=errors-only
  published packages have type:module, exports, files, license, repository
  workspace packages have no devDependencies (hoisted to root)
  no nested .gitignore, no postcss.config.mjs, no @ts-nocheck
  no bun.lock tracked in git
  no redundant clean scripts in sub-packages
  ci status via github api`
