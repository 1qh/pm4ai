# pm4ai watch — Live Dashboard

## Problem

`pm4ai fix --all` and `pm4ai status --all` are fire-and-forget. Output appears only after everything finishes. When an agent runs these commands, a curious human has no way to see real-time progress without interrupting the agent’s workflow.

## Solution

A new `pm4ai watch` command — a read-only live dashboard that subscribes to events emitted by running commands. Zero impact on the running process. Works alongside any command.

## Architecture

### Event Protocol

All observable commands (`fix`, `status`) emit structured JSON events through a Unix domain socket at `~/.pm4ai/watch.sock`.

```typescript
interface WatchEvent {
  project: string
  step: 'sync' | 'audit' | 'maintain' | 'check' | 'done'
  status: 'start' | 'ok' | 'fail'
  detail?: string
}
```

Example event sequence for `fix --all`:

```
{ project: "ogrid",  step: "sync",     status: "start" }
{ project: "lintmax", step: "sync",     status: "start" }
{ project: "ogrid",  step: "sync",     status: "ok",   detail: "3 synced" }
{ project: "ogrid",  step: "audit",    status: "start" }
{ project: "lintmax", step: "sync",     status: "ok",   detail: "1 synced" }
{ project: "lintmax", step: "audit",    status: "start" }
{ project: "ogrid",  step: "audit",    status: "ok",   detail: "1 drift" }
{ project: "ogrid",  step: "maintain", status: "start" }
{ project: "lintmax", step: "audit",    status: "ok" }
{ project: "lintmax", step: "maintain", status: "start" }
{ project: "ogrid",  step: "maintain", status: "ok" }
{ project: "ogrid",  step: "done",     status: "ok",   detail: "2 files modified" }
{ project: "lintmax", step: "maintain", status: "ok" }
{ project: "lintmax", step: "done",     status: "ok",   detail: "clean" }
```

### Components

#### 1. Event Emitter (`src/watch-emitter.ts`)

Thin module used by `fix` and `status` to emit events.

- Creates a Unix socket server at `~/.pm4ai/watch.sock` when the first command starts
- Writes newline-delimited JSON to all connected clients
- If no clients are connected, events are silently dropped (zero overhead)
- Cleans up socket file on process exit
- Non-blocking — `socket.write()` never awaits, never throws

#### 2. Watch Renderer (`src/watch.ts`)

The `pm4ai watch` command — connects to the socket and renders a live dashboard.

- Connects to `~/.pm4ai/watch.sock`
- If no command is running, shows last known state from check cache (`~/.pm4ai/checks/`)
- When events arrive, updates the dashboard in real-time
- Uses **ink** (React for terminals) for the UI
- Auto-exits when the running command finishes, or stays alive showing idle state

#### 3. Instrumentation

Minimal changes to existing commands — add `emit()` calls at step boundaries.

### Dashboard Layout

```
pm4ai watch                                          0.0.6

 lintmax            ✓ synced   ✓ audited   ⠋ maintaining...
 cnsync             ✓ synced   ✓ audited   ✓ clean
 ogrid              ✓ synced   ⠋ auditing...
 idecn              ⠋ syncing...
 noboil             ● pending
 ai-search          ● pending

 fix running (3/6)                                   12s elapsed
```

When idle (no command running):

```
pm4ai watch                                          0.0.6

 lintmax            ✓ passed 5m ago (current)        clean
 cnsync             ✓ passed 5m ago (current)        clean
 ogrid              ✓ passed 5m ago (current)        2 files
 idecn              ✓ passed 5m ago (current)        clean
 noboil             ✓ passed 5m ago (current)        clean
 ai-search          ✓ passed 5m ago (current)        clean

 idle — last fix 5m ago
```

## Changes Required

### New Files

| File                   | Purpose                               |
| ---------------------- | ------------------------------------- |
| `src/watch-emitter.ts` | Unix socket server, `emit()` function |
| `src/watch.ts`         | ink-based dashboard renderer          |

### Modified Files

| File            | Change                                                    |
| --------------- | --------------------------------------------------------- |
| `src/fix.ts`    | Add `emit()` calls at sync/audit/maintain/done boundaries |
| `src/status.ts` | Add `emit()` calls at each check step                     |
| `src/cli.ts`    | Add `watch` command routing                               |
| `package.json`  | Add `ink` and `react` to dependencies                     |

### Not Changed

- `src/sync.ts` — no changes, fix.ts wraps it
- `src/audit.ts` — no changes, fix.ts wraps it
- `src/checks.ts` — no changes, status.ts wraps it
- `src/check-cache.ts` — no changes, watch reads it directly
- All test files — existing tests unaffected, new tests for watch-emitter

## Performance Impact

- **Zero** when no watcher is connected — `emit()` checks for connected clients, drops events if none
- **Negligible** when watcher is connected — each event is ~100 bytes of JSON, `socket.write()` is non-blocking
- **Full parallelism preserved** — `Promise.all` stays, no sequential bottlenecks
- The watch process itself is read-only — no locks, no IPC coordination, no shared mutable state

## New Dependencies

| Dependency | Purpose                 | Size                 |
| ---------- | ----------------------- | -------------------- |
| `ink`      | React-based terminal UI | ~50KB                |
| `react`    | Required by ink         | already in ecosystem |

Both are already used across the ecosystem (every project has react). ink is the standard for rich terminal UIs in the TypeScript ecosystem.

## DX Improvements

- **Human observability** — see what the agent is doing in real-time without interrupting it
- **Debugging** — when `up.sh` takes 5 minutes on noboil, you can see exactly which step it’s stuck on
- **Confidence** — visual confirmation that the tool is working, not hanging
- **Idle dashboard** — quick glance at ecosystem health without running status

## Edge Cases

- Watch starts before any command → shows idle state from check cache
- Watch starts after command is midway → picks up from current state (misses past events, but shows live progress)
- Multiple watchers → all receive the same events (socket supports multiple clients)
- Command crashes → socket closes, watcher shows disconnected state and falls back to check cache
- No socket exists → watcher shows idle state, polls for socket creation

## Future Extensions

- `pm4ai watch --json` — raw event stream for programmatic consumption
- SwiftBar integration — menubar could show live progress during fix
- Web dashboard — serve events over WebSocket instead of Unix socket
