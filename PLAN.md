# pm4ai watch + dashboard

## Problem

`pm4ai fix --all` and `pm4ai status --all` are fire-and-forget. Output appears only after everything finishes. When an agent runs these commands, a curious human has no way to see real-time progress without interrupting the agent’s workflow.

## Solution

Three new capabilities:

1. **`pm4ai watch`** — terminal live dashboard (ink)
2. **`pm4ai dashboard`** — local web dashboard (Next.js + oRPC)
3. **SwiftBar streaming** — menubar live progress during fix

All powered by a shared event system. Negligible impact on running commands.

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
  refreshStatus: os.mutation(({ input }) => spawnStatus(input.all))
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

- **Negligible** when no watcher/dashboard connected — `emit()` checks for clients, drops events (no JSON serialization)
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

### Phase 0: Remaining Foundation Work

**Code improvements:**

- `audit.ts` — `bun pm view` output parsed without validation, silent failure
- `format.ts` — ciTime parsing brittle, coupled to `checks.ts` string format
- `utils.ts` — workspace glob only supports `dir/*` pattern, not nested globs or negations
- Child process → socket race condition for dashboard mutations (document workaround in dashboard code)

**Missing tests (existing code):**

- No `fix.test.ts` — the most dangerous module has zero tests
- No tests for lockfile mechanism (acquire/release/race/stale cleanup)
- No tests for `check-worker.ts`, `log.ts`, `setup.ts`, `preflight.ts`
- No tests for `maintain` function
- No error handling tests (git not installed, network down, disk full)
- `discover.ts` not testable without dependency injection for search root

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

## Testing Strategy

Every new component gets comprehensive tests. Tests should cover happy paths, edge cases, concurrency, and failure modes.

### Event Emitter (`watch-emitter.test.ts`)

**Socket lifecycle:**

- Creates socket at expected path (`~/.pm4ai/watch.sock`)
- Cleans up socket file on close
- Handles socket file already existing (stale from crash) — removes and recreates
- Multiple start/stop cycles without leaking file descriptors
- `~/.pm4ai` directory doesn’t exist — creates it
- Another process holds the socket file — detects and handles
- Emitter started twice in same process — second call is no-op or throws

**Event delivery:**

- Single client receives all events
- Multiple clients (5+) each receive all events independently
- Events are valid newline-delimited JSON (every line parses)
- Event fields match `WatchEvent` interface exactly
- Events arrive in emission order per project
- Events emitted before any client connects are dropped (not queued)
- Events with Unicode in project names/paths delivered correctly
- Events with very long detail strings (10KB+) delivered intact

**No-client behavior:**

- `emit()` is a no-op when no clients connected
- No errors thrown, no buffering, no memory growth
- Benchmark: 10,000 emits with no client < 10ms
- No file descriptors leaked after no-client emit burst

**Client disconnect:**

- Client disconnect doesn’t crash emitter
- Remaining clients continue receiving events uninterrupted
- Reconnecting client receives only new events (no replay)
- All clients disconnect → emitter returns to idle (same as no-client)
- Client disconnects mid-write — no partial JSON corruption to other clients

**Concurrency:**

- Parallel `emit()` calls from multiple async tasks don’t interleave JSON lines
- Client connecting mid-stream receives events from that point forward only
- Socket handles burst of events (1,000 rapid-fire) without dropping
- Events emitted before socket `listen()` completes are handled (race condition)

**Hostile client:**

- Client sends data TO the socket — ignored, no crash, no echo
- Client connects and never reads (backpressure) — doesn’t block other clients
- Client sends malformed data — ignored
- Client opens 100 connections — handled (or limited)

**Cleanup:**

- SIGTERM — socket file removed
- SIGINT — socket file removed
- SIGKILL — socket file orphaned (next start handles it)
- `process.exit()` — socket file removed via exit handler
- Uncaught exception — socket file removed via handler

### Event Protocol (`watch-types.test.ts`)

- All `step` values are valid (`sync`, `audit`, `maintain`, `check`, `done`) — exhaustive
- All `status` values are valid (`start`, `ok`, `fail`) — exhaustive
- `at` is a valid ISO 8601 timestamp with timezone
- `detail` is optional — present on `ok`/`fail`, absent on `start`
- `project` is never empty string
- `project` contains no path separators (just the name)
- Round-trip: emit → receive → parse → compare produces identical event
- JSON serialization is deterministic (same event → same bytes)
- No extra fields allowed (strict schema validation)

### Fix Instrumentation (`fix-events.test.ts`)

- `fix` emits `sync.start` → `sync.ok` for each project
- `fix` emits `audit.start` → `audit.ok` for each project
- `fix` emits `maintain.start` → `maintain.ok/fail` for each project
- `fix` emits `done.ok` with file count in detail for clean projects
- `fix` emits `done.ok` with “clean” in detail when no changes
- Failed maintain emits `maintain.fail` with error detail
- Parallel projects emit interleaved events (correct project attribution — never wrong project)
- Every `start` event has a matching `ok` or `fail` (no orphaned starts)
- Blocked fix (dirty git) emits no project events
- Single-project fix emits events for one project only
- `fix` with no projects found emits no events
- Event timestamps are monotonically increasing per project

### Status Instrumentation (`status-events.test.ts`)

- `status` emits `check.start` → `check.ok` for each project
- `status --all` emits events for all projects in parallel
- Single-project status emits events for one project only
- Check failures emit `check.fail` with detail
- Each check type (git, ci, drift, lint, etc.) emits correctly
- SwiftBar mode (`--swiftbar`) still emits events

### Terminal Watch (`watch.test.ts`)

**Socket connection:**

- Connects to existing socket immediately
- Handles socket not existing (shows idle state from check cache)
- Reconnects after socket disappears and reappears (server restart)
- Reconnect backoff — doesn’t hammer the filesystem
- Graceful shutdown on SIGINT (ctrl+c) — cleans up connection
- Graceful shutdown on SIGTERM

**State rendering:**

- Idle state shows cached check results for all projects
- Idle state with no check cache (fresh install) shows “never checked”
- Incoming events update correct project status
- Projects appear in consistent alphabetical order
- Spinner shown for in-progress steps
- Check mark shown for completed steps
- X mark shown for failed steps
- Elapsed time counter updates during fix
- Transitions: pending → syncing → auditing → maintaining → done
- Multiple projects in different states simultaneously rendered correctly
- Project that finishes stays in “done” state (not removed)

**Terminal handling:**

- Terminal resize during rendering — layout adapts
- Very long project names — truncated with ellipsis
- Non-TTY stdout (piped to file) — falls back to plain text or `--json`
- Color support detection — no ANSI codes when NO_COLOR is set
- Narrow terminal (< 40 cols) — still readable

**`--json` mode:**

- Outputs raw newline-delimited JSON to stdout
- No ink rendering, no ANSI escape codes
- Every line is valid JSON that parses
- Pipe-friendly: `pm4ai watch --json | jq .project` works
- Handles backpressure (slow consumer piped to)

### Dashboard Auth (`dashboard-auth.test.ts`)

**One-time token flow:**

- Generated token is a valid UUID v4
- `/auth/{valid-token}` sets httpOnly cookie and returns 302 redirect to `/`
- Same token fails on second use — returns 401 (consumed)
- Invalid token (random string) returns 401
- Missing token (`/auth/`) returns 404
- Empty token (`/auth/""`) returns 401
- Cookie has httpOnly flag set
- Cookie has SameSite=Strict
- Cookie has Secure flag when behind HTTPS
- Cookie has reasonable expiration (matches session lifetime)
- Response does not include token in any header or body

**Session lifecycle:**

- Authenticated request with valid cookie succeeds (200)
- Request without cookie returns 401
- Dashboard restart generates new token — old cookie returns 401
- Expired cookie returns 401
- Malformed cookie value returns 401
- Cookie from different domain/path rejected

**Concurrent auth:**

- Two requests hitting `/auth/{token}` simultaneously — exactly one succeeds, one gets 401
- Race condition on token consumption — no double-auth possible
- Auth under load (100 concurrent requests with invalid tokens) — all return 401, no crash

**Security hardening:**

- Token comparison is constant-time (no timing side-channel)
- Brute-force `/auth/{random-uuid}` — always 401, no information leakage
- Token not logged in server output
- Token not included in error responses
- CSRF: mutations require valid cookie (SameSite=Strict prevents cross-origin)
- No CORS headers in default config (local only)

### Dashboard oRPC (`dashboard-api.test.ts`)

**Queries:**

- `projects` returns all discovered projects with correct shape
- `projects` returns empty array when no projects found
- `status` returns check result for a specific project
- `status` for unknown project returns typed error
- Unauthenticated query returns 401
- Query response types match TypeScript definitions exactly

**Mutations:**

- `fix` spawns fix process and returns immediately (non-blocking)
- `fix` while fix is already running returns lockfile error (not 500)
- `fix` return value includes the spawned process info
- `fixProject` targets single project correctly
- `fixProject` with invalid project name returns typed error
- Unauthenticated mutation returns 401
- Mutation input validation — missing fields rejected
- Mutation input validation — extra fields stripped or rejected
- Double-click scenario: rapid duplicate mutations — second blocked by lockfile

**Subscriptions (SSE):**

- Client receives events in real-time (< 50ms latency)
- Multiple clients receive identical events
- Client reconnect resumes event stream (SSE `Last-Event-ID` or equivalent)
- No events when nothing is running — stream stays open, idle
- Unauthenticated subscription returns 401
- SSE format: `data: {...}\n\n` per event
- Connection kept alive with heartbeat/comment when idle
- Client disconnect doesn’t crash server
- 10+ simultaneous SSE clients handled

**Type safety:**

- All procedure inputs validated at runtime against schema
- All procedure outputs match their TypeScript type definitions
- Invalid input shapes rejected with structured typed errors
- oRPC contract matches implementation — build fails if they diverge

**Error handling:**

- Server error during query — returns 500 with safe error message (no stack trace)
- Server error during mutation — returns 500, mutation rolled back if applicable
- Network timeout on long-running mutation — client can reconnect and check status
- Invalid JSON body — returns 400

### Dashboard UI (`dashboard-ui.test.ts`)

**Rendering:**

- Project grid shows all projects
- Each project card shows name, status, git state
- Loading state shown while initial data fetches
- Error state shown when API unreachable

**Live updates:**

- SSE event updates the correct project card in real-time
- Spinner appears when project step is `start`
- Spinner replaced by check/x when step completes
- Event log shows newest events first
- Event log scrollable, doesn’t push layout

**Quick actions:**

- Fix button triggers fix mutation
- Fix button disabled while fix is running (lockfile)
- Status button triggers status refresh
- Visual feedback on action success/failure

**Responsive:**

- Renders correctly on mobile viewport (port-forwarded to phone)
- Renders correctly on ultra-wide monitor
- Dark mode support (follows system preference)

### SwiftBar Streaming (`swiftbar-stream.test.ts`)

- Plugin connects to Unix socket
- Plugin renders project status with correct SwiftBar color attributes
- Plugin shows spinner character during active fix
- Plugin falls back to polling mode when socket unavailable
- Plugin handles socket disconnect gracefully — reverts to polling
- Plugin handles socket reconnect — switches back to streaming
- Output format matches SwiftBar streaming spec (`~~~` line separator)
- Idle output matches current behavior exactly (backward compatible)
- Multiple SwiftBar plugin instances — each gets events independently
- Plugin doesn’t crash when SwiftBar sends refresh signal
- macOS permissions: plugin can access `~/.pm4ai/watch.sock`

### Integration Tests

**Full flow: emit → watch:**

- Start emitter, connect watch, emit events, verify watch state updates
- Multiple projects in parallel — verify no event loss, all projects tracked
- Emitter restart mid-watch — watch reconnects and continues
- Watch started before emitter — shows idle, then connects when emitter starts

**Full flow: emit → dashboard:**

- Start emitter, start dashboard, connect SSE, emit events, verify browser receives them
- Auth flow → subscribe → receive events → mutation → verify lockfile created
- Dashboard restart — re-auth required, SSE reconnects
- Emitter restart — SSE reconnects automatically

**Full flow: fix → watch + dashboard simultaneously:**

- Run fix, connect both watch and dashboard
- Verify both receive identical events in same order
- Neither consumer affects fix performance

**Full flow: fresh install:**

- No `~/.pm4ai` directory exists
- Run `pm4ai watch` — shows empty/idle state
- Run `pm4ai fix --all` in another terminal — watch picks up events
- After fix completes — watch shows results from check cache

**Full flow: crash recovery:**

- Fix crashes mid-run (SIGKILL)
- Watch shows stale state with last known step
- New fix starts — watch recovers and shows fresh progress
- Orphaned socket file cleaned up on new fix start

**Full flow: rapid cycles:**

- Fix finishes, immediately starts again
- Watch handles transition cleanly — done state → new pending state
- No ghost events from previous run

### Regression Tests

- All 88+ existing tests still pass with emit() calls added
- fix/status output format unchanged when no watcher connected
- fix/status exit codes unchanged
- fix lockfile behavior unchanged
- check cache behavior unchanged
- SwiftBar non-streaming mode unchanged

### Performance Tests

**Emitter throughput:**

- 10,000 events/second with 5 clients — measure per-event latency (p50, p95, p99)
- 10,000 events/second with 0 clients — verify < 10ms total (pure overhead)
- Memory usage stable over 100,000 events (no leak)

**Dashboard SSE:**

- 1,000 events/second — verify browser client keeps up
- SSE with 10 simultaneous browser clients — server memory stable
- SSE reconnect storm (10 clients reconnecting simultaneously) — server handles gracefully

**Resource cleanup:**

- File descriptor count same before and after test suite
- No zombie child processes after mutation tests
- No orphaned socket files after test suite
- Temp files cleaned up
- 100 connect/disconnect cycles — no fd leak

**Baseline impact:**

- fix --all with no watcher: measure runtime before and after emit() instrumentation
- Difference should be < 1% (within noise)
- status --all with no watcher: same measurement

---

## Future Extensions

- **Event persistence** — write events to `~/.pm4ai/events.jsonl` for history/timeline view
- **Notifications** — desktop notifications on fix failure (via `node-notifier` or native `osascript`)
- **Multi-machine** — dashboard accessible from phone/tablet on same network
- **Webhooks** — emit events to external services (Slack, Discord) on fix completion/failure
