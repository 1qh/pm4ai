export const guide = `pm4ai — zero-config project manager for TypeScript monorepos

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
    missing LEARNING.md
    missing turbo.json

flags:
  --swiftbar     output in SwiftBar menubar format

synced files (copied verbatim from pm4ai repo):
  clean.sh  up.sh  bunfig.toml  .gitignore  CLAUDE.md (generated from rules)

checked files (warn if missing):
  turbo.json  tsconfig.json  .github/workflows/ci.yml
  simple-git-hooks + prepare script in package.json
  LEARNING.md  RULES.md  PROGRESS.md  PLAN.md`
