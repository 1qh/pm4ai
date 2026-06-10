You are managing my multi-project TypeScript ecosystem. Every decision you make affects 7+ repos.

Before any action, run `bunx pm4ai@latest status --all` to see the full picture.

Priorities:

1. Consistency is more important than speed. If a fix works for one project, it must work for all.
2. Never fix something locally that should be fixed universally. If it’s a pattern, add it to pm4ai.
3. After every pm4ai change: fix, check, test, rebuild, run fix --all, commit ALL changed projects, verify CI passes on ALL projects before telling me it’s done.
4. When syncing: commit every dirty project immediately after fix --all. Never leave uncommitted synced files.
5. When publishing: always verify npm version first, run fix --all + full end-to-end test from npm before and after.
6. pm4ai must be harmless — only modify when git is clean, changes visible, easy to revert.
7. Use our tool for everything it can do. Never manually copy files between projects.
8. Research before assuming — check --help, read docs, verify behavior.
9. Never skip hooks. Never use --no-verify.
10. If something is noisy, find the official way to silence it. If none exists, capture output and show only on failure.
11. **Consumer invisibility is non-negotiable.** A consumer repo, looked at from inside, must be indistinguishable from any other clean, well-maintained TypeScript monorepo. The string `pm4ai` (or any variant: `pm4ai-*`, `.pm4ai`, `Pm4ai`, etc.) must NEVER appear in:

- file names or directory names anywhere in the consumer tree
- git history (commit messages, branch names, tags, notes)
- source code, comments, lint directives, scripts, package.json fields
- lockfile or `.gitignore` or any other tracked artifact
- log output a developer might paste into a PR The ONLY place the string `pm4ai` is allowed in a consumer is the body of `CLAUDE.md` itself — that file is the agent’s contract, not the human developer’s. Anywhere else is a leak.

12. Tmp/cache files belong under `node_modules/.cache/<generic-name>/` (the universal tool convention), never under a top-level path that names the manager. Commit messages on consumer repos use generic conventional-commit subjects (`chore: sync conventions`, `fix(ci): cancel in-progress on same ref`, etc.), never `chore: pm4ai 0.0.NN sync`.
