# pm4ai watch + dashboard

## Problem

`pm4ai fix --all` and `pm4ai status --all` are fire-and-forget. Output appears only after everything finishes. When an agent runs these commands, a curious human has no way to see real-time progress without interrupting the agent’s workflow.

## Solution

Three new capabilities:

1. **`pm4ai watch`** — terminal live dashboard (ink)
2. **`pm4ai dashboard`** — local web dashboard (Next.js + oRPC)
3. **SwiftBar streaming** — menubar live progress during fix

All powered by a shared event system. Zero impact on running commands.

---

## Architecture

### Event Flow

```
fix/status (producer)
    │
    ├─ emit() ──► Unix socket (~/.pm4ai/watch.sock)
    │                 │
    │                 ├──► pm4ai watch (ink terminal UI)
    │                 ├──► pm4ai dashboard (Next.js, relays via oRPC SSE)
    │                 └──► SwiftBar plugin (streaming mode)
    │
    └─ (existing) ──► check cache (~/.pm4ai/checks/*.json)
                      fix lockfile (~/.pm4ai/fix.lock)
```

### Event Protocol

```typescript
interface WatchEvent {
  at: string
  detail?: string
  project: string
  status: 'fail' | 'ok' | 'start'
  step: 'audit' | 'check' | 'done' | 'maintain' | 'sync'
}
```

Example event sequence for `fix --all` (6 projects, parallel):

```jsonl
{"at":"...","project":"lintmax","step":"sync","status":"start"}
{"at":"...","project":"ogrid","step":"sync","status":"start"}
{"at":"...","project":"cnsync","step":"sync","status":"start"}
{"at":"...","project":"lintmax","step":"sync","status":"ok","detail":"2 synced"}
{"at":"...","project":"lintmax","step":"audit","status":"start"}
{"at":"...","project":"ogrid","step":"sync","status":"ok","detail":"3 synced"}
{"at":"...","project":"ogrid","step":"audit","status":"start"}
{"at":"...","project":"cnsync","step":"sync","status":"ok"}
{"at":"...","project":"cnsync","step":"done","status":"ok","detail":"clean"}
{"at":"...","project":"lintmax","step":"audit","status":"ok"}
{"at":"...","project":"lintmax","step":"maintain","status":"start"}
{"at":"...","project":"ogrid","step":"audit","status":"ok","detail":"1 drift"}
{"at":"...","project":"ogrid","step":"maintain","status":"start"}
{"at":"...","project":"lintmax","step":"maintain","status":"ok"}
{"at":"...","project":"lintmax","step":"done","status":"ok","detail":"clean"}
{"at":"...","project":"ogrid","step":"maintain","status":"ok"}
{"at":"...","project":"ogrid","step":"done","status":"ok","detail":"2 files modified"}
```

---

## Component 1: Event Emitter

**File:** `packages/pm4ai/src/watch-emitter.ts`

- Creates Unix socket server at `~/.pm4ai/watch.sock`
- Writes newline-delimited JSON to all connected clients
- If no clients connected, events are silently dropped (zero overhead)
- Cleans up socket file on process exit
- Non-blocking — `socket.write()` never awaits, never throws

```typescript
const emit = (event: WatchEvent) => {
  const line = JSON.stringify(event) + '\n'
  for (const client of clients) client.write(line)
}
```

### Instrumentation

Minimal changes to `fix.ts` and `status.ts` — add `emit()` calls at step boundaries. No changes to `sync.ts`, `audit.ts`, `checks.ts`, or any other module.

---

## Component 2: Terminal Watch (`pm4ai watch`)

**File:** `packages/pm4ai/src/watch.ts`

Uses **ink** (React for terminals) to render a live dashboard.

- Connects to `~/.pm4ai/watch.sock`
- When no command is running, shows last known state from check cache
- When events arrive, updates in real-time
- Supports `--json` flag for raw event streaming (no ink, just stdout)

### Terminal Layout

During fix:

```
pm4ai                                                0.0.6

 lintmax            ✓ synced   ✓ audited   ⠋ maintaining...
 cnsync             ✓ synced   ✓ audited   ✓ clean
 ogrid              ✓ synced   ⠋ auditing...
 idecn              ⠋ syncing...
 noboil             ● pending
 ai-search          ● pending

 fix running (3/6)                                   12s elapsed
```

Idle:

```
pm4ai                                                0.0.6

 lintmax            ✓ passed 5m ago (current)        clean
 cnsync             ✓ passed 5m ago (current)        clean
 ogrid              ✓ passed 5m ago (current)        2 files
 idecn              ✓ passed 5m ago (current)        clean
 noboil             ✓ passed 5m ago (current)        clean
 ai-search          ✓ passed 5m ago (current)        clean

 idle — last fix 5m ago
```

---

## Component 3: Web Dashboard (`pm4ai dashboard`)

**App:** `apps/dashboard` (Next.js App Router)

**API:** oRPC with SSE subscriptions

### Auth Flow (zero-friction, maximum security)

1. `pm4ai dashboard` starts, generates a one-time token via `crypto.randomUUID()`
2. Creates a one-time `/auth/{token}` endpoint
3. Auto-opens browser: `open http://localhost:4200/auth/{token}`
4. Server validates token, deletes it immediately (one-time use), sets httpOnly cookie
5. Redirects to `/` — user is authenticated
6. All subsequent requests validated via cookie middleware
7. Dashboard restart = new token = old cookie invalid

For port-forwarded usage: the one-time URL is printed to terminal, user copies it manually.

Token properties:

- Session-scoped (lives only while dashboard process runs)
- One-time use (consumed on first visit)
- Stored in memory only (not written to disk after auth)
- httpOnly cookie (not accessible via JavaScript, not in URLs, not in browser history)

### oRPC Layer

```typescript
const router = {
  // Queries
  projects: os.query(() => getProjects()),
  status: os.query(({ input }) => getProjectStatus(input.project)),

  // Subscriptions (SSE)
  events: os.subscription(async function* () {
    for await (const event of socketEventIterator()) {
      yield event
    }
  }),

  // Mutations (with auth middleware)
  fix: os.mutation(({ input }) => spawnFix(input.all)),
  fixProject: os.mutation(({ input }) => spawnFix(false, input.project)),
  status: os.mutation(({ input }) => spawnStatus(input.all))
}
```

Mutations spawn the CLI as a child process — no direct function calls. This ensures:

- Same behavior as running from terminal
- Lockfile protection works
- Events flow through the same socket
- No risk of shared state corruption

### Dashboard UI

Single-page layout with three sections:

**Header:** pm4ai version, auth status, uptime

**Project Grid:** One card per project showing:

- Project name (links to GitHub)
- Current status (live spinner during fix, cached result when idle)
- Last check time and staleness
- Git state (clean/dirty/ahead/behind)
- Quick actions: Fix, Status, Open in VSCode/Ghostty

**Event Log:** Scrollable timeline of recent events, live-updating

### Tech Stack

| Layer     | Choice                           | Reason                                                    |
| --------- | -------------------------------- | --------------------------------------------------------- |
| Framework | Next.js App Router               | Already in ecosystem, RSC for fast initial load           |
| API       | oRPC                             | End-to-end type safety, first-class SSE, built-in OpenAPI |
| Streaming | oRPC SSE subscriptions           | No WebSocket server needed, auto-reconnect                |
| UI        | shadcn + tailwind                | Already used across all projects                          |
| State     | oRPC + react-query               | Type-safe cache invalidation on mutations                 |
| Auth      | httpOnly cookie + one-time token | Zero-friction, no library needed                          |

---

## Component 4: SwiftBar Streaming

**File:** Update `packages/pm4ai/src/setup.ts`

SwiftBar supports streaming plugins — the script stays alive and outputs new content separated by `~~~`. The plugin connects to the Unix socket and updates the menubar in real-time.

During fix:

```
⠋ 3/6
---
lintmax ✓ | color=green
cnsync ✓ | color=green
ogrid ⠋ maintaining... | color=orange
idecn ⠋ syncing... | color=orange
noboil ● | color=gray
ai-search ● | color=gray
```

When idle, falls back to current behavior (🟢/🔴 per project).

---

## Changes Required

### New Files

| File                                  | Purpose                                              |
| ------------------------------------- | ---------------------------------------------------- |
| `packages/pm4ai/src/watch-emitter.ts` | Unix socket server, `emit()` function                |
| `packages/pm4ai/src/watch.ts`         | ink terminal dashboard                               |
| `packages/pm4ai/src/watch-types.ts`   | `WatchEvent` interface, shared between all consumers |
| `apps/dashboard/`                     | Next.js web dashboard (entire app)                   |

### Modified Files

| File                           | Change                                      |
| ------------------------------ | ------------------------------------------- |
| `packages/pm4ai/src/fix.ts`    | Add `emit()` at step boundaries             |
| `packages/pm4ai/src/status.ts` | Add `emit()` at check boundaries            |
| `packages/pm4ai/src/cli.ts`    | Add `watch` and `dashboard` command routing |
| `packages/pm4ai/src/setup.ts`  | Update SwiftBar plugin to streaming mode    |
| `packages/pm4ai/package.json`  | Add `ink`, `react` to dependencies          |
| `apps/dashboard/package.json`  | New: `next`, `react`, `@orpc/*`, `@a/ui`    |

### Not Changed

- `src/sync.ts` — fix.ts wraps it
- `src/audit.ts` — fix.ts wraps it
- `src/checks.ts` — status.ts wraps it
- `src/check-cache.ts` — watch reads it directly
- Existing tests — unaffected

---

## New Dependencies

### packages/pm4ai

| Dependency | Purpose                                   |
| ---------- | ----------------------------------------- |
| `ink`      | React-based terminal UI for watch command |
| `react`    | Required by ink                           |

### apps/dashboard

| Dependency              | Purpose                            |
| ----------------------- | ---------------------------------- |
| `next`                  | Web framework                      |
| `react`, `react-dom`    | UI                                 |
| `@orpc/server`          | Typed API procedures               |
| `@orpc/client`          | Typed client                       |
| `@orpc/react-query`     | React bindings with cache          |
| `@tanstack/react-query` | Required by oRPC react             |
| `@a/ui`                 | Shared UI components (from cnsync) |
| `tailwindcss`           | Styling                            |

---

## Performance Impact

- **Zero** when no watcher/dashboard connected — `emit()` checks for clients, drops events
- **Negligible** when connected — ~100 bytes JSON per event, non-blocking write
- **Full parallelism preserved** — `Promise.all` untouched, no sequential bottlenecks
- **Dashboard** — separate Next.js process, shares nothing with CLI except the socket

---

## Security Model

| Concern              | Mitigation                                                   |
| -------------------- | ------------------------------------------------------------ |
| Unauthorized access  | One-time auth token + httpOnly cookie                        |
| Token leakage        | Token consumed on first use, never in URLs after auth        |
| Command injection    | Server actions call fixed functions, no string interpolation |
| Concurrent mutations | Lockfile prevents double fix runs                            |
| Port forwarding      | Cookie-based auth works over any transport                   |
| Session hijacking    | Token rotates on every dashboard restart                     |
| XSS                  | httpOnly cookie not accessible via JavaScript                |

---

## Implementation Order

### Phase 1: Event System + Terminal Watch

1. `watch-types.ts` — shared event interface
2. `watch-emitter.ts` — Unix socket server
3. Instrument `fix.ts` and `status.ts` with `emit()` calls
4. `watch.ts` — ink terminal dashboard
5. `watch --json` — raw event streaming mode
6. CLI routing for `watch` command
7. Tests for emitter and event protocol

### Phase 2: Web Dashboard

1. Scaffold `apps/dashboard` with Next.js
2. oRPC router — queries, subscriptions, mutations
3. Auth flow — one-time token + cookie
4. Dashboard UI — project grid, event log, quick actions
5. SSE subscription — live event streaming to browser
6. Connect to `@a/ui` for shared components

### Phase 3: SwiftBar Streaming

1. Update SwiftBar plugin to streaming mode
2. Connect to Unix socket for live progress
3. Fallback to current polling when socket unavailable

---

## Future Extensions

- **Event persistence** — write events to `~/.pm4ai/events.jsonl` for history/timeline view
- **Notifications** — desktop notifications on fix failure (via `node-notifier` or native `osascript`)
- **Multi-machine** — dashboard accessible from phone/tablet on same network
- **Webhooks** — emit events to external services (Slack, Discord) on fix completion/failure
