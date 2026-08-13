You are managing my multi-project TypeScript ecosystem. Every decision you make affects 7+ repos.

Before any action, run `bunx pm4ai@latest status --all` to see the full picture.

Priorities:

1. Consistency is more important than speed. If a fix works for one project, it must work for all.
2. Never fix something locally that should be fixed universally. If it’s a pattern, add it to pm4ai.
3. After every pm4ai change: fix, check, test, rebuild, run fix --all, commit ALL changed projects, verify CI passes on ALL projects before telling me it’s done. CI-green and `status --all` clean are each necessary and NEITHER is sufficient: CI proves builds and tests, `status --all` detects drift only over managed files — both are blind to the lint-autofix and codegen regeneration that `fix` also applies. The definitive proof a project is synced is that a fresh `fix` produces ZERO diff; a later `fix` on an “already green” repo that yields any managed-file, codegen, or lint diff means it was called green on the weaker evidence. Verify per-repo and commit each result.
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

13. `status --all` is the fleet’s health, not memory. A red member — a CI failure, a deploy failure, a violation the latest linter now enforces, an owed maintenance — is an open obligation the moment it prints, whoever caused it and even on a repo you never touched; all-green is the only stop. Enumerate from `status --all` because the red member is reliably the one you were not thinking about.

14. `fix --all` (and the sync generally) SERIALISES on a global lock plus a fleet-wide clean-git precondition — it aborts if ANY managed repo, including pm4ai’s own self-checkout, is dirty. So never run parallel grinders against the sync: they queue on the one lock and deadlock the instant the tool regenerates its own uncommitted `CLAUDE.md`, each spinning a retry that reads as progress while nothing lands (measured: eleven parallel grinders deadlocked this way). Commit the manager’s self-repo FIRST, then run ONE serial loop. Independent PER-REPO gates (each repo’s build/lint/CI-faithful `up.sh`) MAY parallelise — only the sync itself is serial. On a shared runner, stagger pushes: N simultaneous pushes fire N concurrent CI runs on one machine and flake red on `EAGAIN`.
