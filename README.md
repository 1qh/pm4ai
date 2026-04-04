# pm4ai

Agent-first anti-slop project management for TypeScript monorepos.

One source of truth. Zero manual maintenance.

## Quick Start

```sh
bunx pm4ai@latest status    # see all issues
bunx pm4ai@latest fix       # fix everything
bunx pm4ai@latest init app  # new project
bunx pm4ai@latest setup     # menubar + daily auto-run
```

## How It Works

pm4ai discovers all your TypeScript projects by scanning for `lintmax` in package.json deps. No config files, no registration.

**`pm4ai status`** checks everything across every project — git status, config drift, dep audit, CI status, Vercel deployments — and reports only issues.

**`pm4ai fix`** syncs dotfiles, generates CLAUDE.md from rules, copies readonly/ui, runs maintenance (`sh up.sh`) on every project in parallel.

**`pm4ai init`** scaffolds a new project with turbo, lintmax, sherif, simple-git-hooks, CI workflow — everything correct from day one.

**`pm4ai setup`** installs a SwiftBar menubar plugin (hourly refresh) and a launchd agent (daily auto-fix).

## For Agents

```
curl https://pm4ai.vercel.app/llms.txt
```
