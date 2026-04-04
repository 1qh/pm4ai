# pm4ai

Agent-first anti-slop project management for TypeScript monorepos.

One source of truth. Zero manual maintenance.

## Quick Start

```sh
bunx pm4ai@latest status       # check current project
bunx pm4ai@latest fix          # sync + maintain current project
bunx pm4ai@latest status --all # check all projects
bunx pm4ai@latest fix --all    # sync + maintain all projects
bunx pm4ai@latest init app     # scaffold a new project
bunx pm4ai@latest setup        # menubar + daily auto-run
```

## How It Works

pm4ai is context-aware. Inside a project, it operates on that project only. Use `--all` to scan everything.

**`pm4ai status`** checks the current project — git status, config drift, dep audit, CI status, Vercel deployments — and reports only issues.

**`pm4ai fix`** syncs dotfiles, generates CLAUDE.md from rules, copies readonly/ui, runs maintenance (`sh up.sh`).

**`pm4ai init`** scaffolds a new project with turbo, lintmax, sherif, simple-git-hooks, CI workflow — everything correct from day one.

**`pm4ai setup`** installs a SwiftBar menubar plugin (hourly refresh) and a launchd agent (daily auto-fix).

## For Agents

```
curl https://pm4ai.vercel.app/llms.txt
```
