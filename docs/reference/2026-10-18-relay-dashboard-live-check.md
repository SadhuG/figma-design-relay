# Relay dashboard verification — 2026-10-18

Status: **blocked; the required live Figma gate has not passed.** Do not open the dashboard PR or
merge this candidate until the checks below pass, or the user explicitly grants an exception.

## Candidate and setup

- Branch: `feat/relay-dashboard`. Merge `f645c8b` incorporates landed upstream integration
  `43bdaef` from `origin/dev`, followed by `origin/main` (`6e18047`, already an ancestor at this
  refresh). Both packages remain 0.9.0. The upcoming main promotion still requires a final refresh.
- Worktree: `C:/Users/sadhu/code/figma-design-relay-relay-dashboard`.
- Dev plugin: `Figma Design Relay (Dev: relay-dashboard, port 1996)`.
- Stable relay and MCP configuration were not changed.
- The candidate preserves the panel's MCP agent name and the dashboard's call origin together:
  `Bridge.sendWithParams` accepts the agent as argument five and origin as argument six. Regression
  tests cover a local Node, follower Node, direct follower RPC and `save_screenshots` export.

## Blocker observed

Figma Desktop had the native **Pick extension manifest file** dialog open. Behind it, Figma showed
**An error occurred while loading the plugin environment**. The Windows computer-use API exposed
only the parent `Figma Design Relay - Figma` window, with no separately targetable picker window.
Its accessibility observation included the picker's File name field, but setting that field
failed with `element 601 is not available in cached app state for Figma.exe`.

No text or keyboard input was sent to the underlying canvas. UI recovery stopped after that
failure rather than risking document changes. The picker was left open, and no plugin relaunch or
live tool call was attempted against this candidate.

## Required cases still pending

1. Relaunch the exact rebuilt Dev plugin in a Design file and FigJam board; confirm both cards,
   editor badges and connected times.
2. Make a successful local `get_selection`; confirm **This relay**, OK and duration.
3. Make a node-addressed follower `get_node`; confirm the requested node, agent name in the panel,
   **Follower <pid>** in activity and its process row.
4. Make a failing `get_node`; confirm error text and **Only failed calls** filtering.
5. Close the FigJam plugin; confirm its card disappears on the next poll.
6. Stop and restart only the dev relay; confirm the offline banner appears and clears without
   reloading the dashboard.
7. Request `/api/status` with `Host: evil.example`; confirm 403 on the live dev relay.
8. Confirm `list_files` retains its public shape without `connectedAt`.

After recovery, refresh the feature branch from landed `origin/dev` and `origin/main`, rebuild,
repeat affected checks and replace this blocked record with commit-specific passing evidence and
a dashboard screenshot. The untracked `server/.smoke/dashboard-live.mjs` harness is preserved for
that session; verify it actually owns the dev leader before treating its calls as local.

## Independent review findings addressed

- P1: `new URL` in the GET routing listener could throw on `//` and terminate the Node leader.
  Commit `4d14be7` catches malformed GET targets with 400 and closes malformed upgrade sockets.
  Its regression test first reproduced the uncaught `ERR_INVALID_URL`. After the fix, both the
  test and `node server/.smoke/dashboard-routing.mjs` (Node 24.20.0, after building) confirm that
  malformed requests are rejected, `/ping` and `/api/status` remain healthy, and foreign Host
  requests still receive 403. The smoke harness uses an ephemeral port and never touches Figma.
- P2 (D2): file-card last-call time was derived from the bounded, completed activity history.
  The bridge now retains optional `lastCallAt` on each connection at dispatch; the status API and
  renderer use it while `list_files` keeps its prior shape. Regression tests first failed for
  in-flight calls, reversed completion order, eviction by another file's 201 calls, and rendering
  a timestamp independently of activity history; all pass after the fix.

These fixes still require independent review of their final commits and the affected live checks.
