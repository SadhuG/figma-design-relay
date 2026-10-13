# Relay Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Load only this file plus the current phase file.

**Goal:** The leader relay serves a read-only status page at `http://127.0.0.1:<port>/` that shows
connected Figma files, recent tool calls and follower processes.

**Architecture:** The bridge records every tool call it sends into an in-memory ring buffer
(`ActivityLog`); the leader remembers followers by a process-id header (`FollowerRegistry`). The
leader exposes both through `GET /api/status`, behind a Host/Origin guard, and serves a static page
from `server/dashboard/` that polls it every two seconds and renders with pure, unit-tested
functions.

**Tech Stack:** TypeScript (Node16 ESM, `tsc`), `node:http`, `ws`, Bun test; plain HTML, CSS and
browser ES modules for the page.

**Spec:** [`../../specs/2026-10-14-relay-dashboard-design.md`](../../specs/2026-10-14-relay-dashboard-design.md)
(requirements D1–D11).

## Context

- The leader (`server/src/leader.ts`) already runs a `node:http` server on `127.0.0.1:<port>` with
  `/ping`, `/rpc` and the `/ws` upgrade. Every tool call reaches Figma through
  `Bridge.sendWithParams` (`server/src/bridge.ts`): local calls via `Node.sendWithParams`, follower
  calls via `Leader.handleRPC`.
- Followers (`server/src/follower.ts`) and the election (`server/src/election.ts`) call the leader
  over HTTP; today the leader cannot tell them apart.
- The release zip ships `server/dist`, `package.json` and `bun.lock` only
  (`.github/workflows/release.yml`), so the page's static files need their own copy step.

## Global Constraints

- Bun everywhere — never `npm` or `yarn`. No new dependencies in either package (D10).
- Server imports carry the `.js` extension (`./activity.js`).
- The leader binds `LOOPBACK_HOST` (`127.0.0.1`) only. Never add CORS headers.
- Dashboard routes are `GET` only and never call a tool (D7).
- The log never stores params, node ids, script source or returned data (D6); error text is cut to
  300 characters; the buffer holds 200 calls.
- Everything is LF. Write regex-bearing source with the Edit/Write tools, never a shell heredoc.
- `bun run format` from the root before every commit. Commit messages: `feat(server): …`,
  `test: …`, `docs: …`, `chore: …`, ending with the attribution line in use for the session.
- Code tasks run in a worktree with its own dev slot: run the `start-feature` skill before the
  first edit (slug: `relay-dashboard`).

## Shared data model

Defined in Phase 1 and 2; later phases rely on these exact names. The page receives this JSON from
`GET /api/status`:

```ts
type CallOrigin = { kind: "local" } | { kind: "follower"; instance: string | null };

interface ActivityEntry {
  id: number; // increasing per leader
  tool: string;
  fileKey: string | null; // null when no file could be resolved
  fileName: string | null;
  origin: CallOrigin;
  startedAt: number; // epoch ms
  durationMs: number;
  ok: boolean;
  error?: string; // ≤ 300 chars, present only when ok is false
}

interface FollowerSeen {
  instance: string; // the follower's process id
  lastSeen: number; // epoch ms
  calls: number; // /rpc calls received from it
}

interface RelayStatus {
  version: string;
  port: number;
  pid: number;
  startedAt: number;
  now: number; // the leader's clock, so the page computes "x ago" without clock skew
  files: Array<ConnectedFile & { connectedAt: number }>;
  followers: FollowerSeen[]; // seen in the last 60 s, most recent first
  activity: ActivityEntry[]; // newest first
}
```

Followers identify themselves with the header `X-Relay-Instance: <process.pid>` (constant
`INSTANCE_HEADER = "x-relay-instance"`, value `INSTANCE_ID`).

## Review Focus

Inputs the spec implies that are most likely to hurt a real user, and the test that pins each:

1. **A Figma file or error message containing HTML** (`<img src=x onerror=…>`) must show as text,
   never run → Phase 3, Task 1 "escapes a hostile file name and error".
2. **A web page re-resolving its own domain to 127.0.0.1** (DNS rebinding, `Host: evil.example`)
   must get 403, not the file list → Phase 2, Task 2 "refuses a rebinding host name".
3. **The plugin closing mid-call** must leave a failed entry, not a call that never finishes →
   Phase 1, Task 2 "records a call whose plugin disconnected mid-request".
4. **A call made with no matching file** (wrong or missing `fileKey`) must still appear, with no file
   and the error text → Phase 1, Task 2 "records a call that could not find its file".
5. **A huge error message** (a stack or script dump) must not bloat the status reply → Phase 1,
   Task 1 "shortens long error text".

## Phases

| #   | Phase                                              | Summary                                                                                                                                            | Status      |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | [Activity data](01-activity-data.md)               | `ActivityLog` and `FollowerRegistry`; the bridge records every call with its origin and outcome; followers and the election send their process id. | not started |
| 2   | [Status endpoint and guard](02-status-endpoint.md) | `GET /api/status`, static file serving and the Host/Origin guard on the leader, plus the page's HTML shell.                                        | not started |
| 3   | [Dashboard page](03-dashboard-page.md)             | Pure render functions with unit tests, the polling script and the stylesheet.                                                                      | not started |
| 4   | [Ship](04-ship.md)                                 | Release packaging, docs, live Figma check, then `finish-task` (version 0.8.0, review, merge).                                                      | not started |
