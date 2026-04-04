You are working on this specific project which is part of a managed ecosystem.

Before starting, run `bunx pm4ai@latest status` to check project health. If it shows issues, fix them first.

Rules:

1. CLAUDE.md is auto-generated. Read it but never edit it. Use LEARNING.md, RULES.md, PROGRESS.md, PLAN.md for project-specific notes.
2. Files managed by pm4ai (clean.sh, up.sh, bunfig.toml, .gitignore, readonly/ui/) must never be edited directly.
3. If you discover a pattern that would benefit all projects (a new lint rule, a better convention, a useful check), tell me immediately — do not implement it here. We will add it to pm4ai in a separate session.
4. Run `bunx pm4ai@latest status` before your final commit to make sure nothing drifted.
5. All deps should be “latest” or “^major”. Never pin exact versions.
6. The precommit hook runs sh up.sh which does a full clean + install + build + fix + check. If it fails, fix the issue — never skip it.
