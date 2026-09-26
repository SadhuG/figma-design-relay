---
name: live-figma-check
description: Use when verifying a figma-design-relay change against a real Figma document, probing a tool through the smoke harness, or debugging a plugin that will not connect, returns bare token ids, or has vanished from list_files.
---

# Checking against a live Figma file

`server/.smoke/` drives real tool calls exactly as an MCP client would: `probe.mjs` runs
`run_script`, `call.mjs` runs any tool by name. **Read `server/.smoke/README.md` first** — it covers
the three setups (join the client's relay, hold your own leader, isolated port 1995), reading the
output, and diagnosing the wiring with `netstat`.

```bash
cd server && bun run build
node .smoke/probe.mjs 'return figma.currentPage.name;'
node .smoke/call.mjs get_selection
```

## The machine's setup

- **One port, 1994, everywhere** — the client's relay, a default plugin build and the probes.
  `server/.smoke/port.mjs` is the harness's single source; `SMOKE_PORT` the only override. Probes
  join the leader on 1994 as followers. After using the 1995 setup, rebuild the plugin **without**
  `VITE_FIGMA_DESIGN_RELAY_WS`.
- The MCP entry is `mcpServers.figma-design-relay` in `~/.claude.json` and must point at **this
  checkout's** `server/dist/index.js`. "Connection closed" at session start usually means it
  points somewhere else. There is exactly one relay on this machine: the old
  `@gethopp/figma-mcp-bridge` entry (bound to `[::]`, it swallowed every probe) and the
  `feat-run-script` worktree are gone — do not bring either back.
- Keep exactly **one** Development-menu import of the plugin, from this checkout's
  `plugin/manifest.json`.

## Symptoms that cost real time

| Symptom                                                         | Cause and fix                                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin "running but not connected", no socket in `netstat`      | It dials another port — a leftover 1995 build or a second import. Its panel's **Relay:** row says which.                                                          |
| Library tokens come back as bare ids; each lookup takes ~11 s   | The plugin was hot-reloaded after a rebuild, and a hot-reloaded sandbox cannot fetch library assets. Close the panel and run it again (~300 ms per lookup).       |
| A probe ignores a schema, leader or bridge change               | The leader still runs the `dist` it started from. Restart the client's relay, or use port 1995.                                                                   |
| A node-addressed tool acts on the wrong node through a follower | `validateRpc` strips `nodeId`; send the id on `nodeIds`.                                                                                                          |
| `fileKey` looks like `unsaved-…`                                | Normal — Figma exposes `figma.fileKey` only to private plugins. Pass the real key from the file URL where one is needed.                                          |
| Agent gets Figma's raw permission message                       | A permission-gated global (`figma.teamLibrary`, `figma.currentUser`) was read outside `withPermissionContext`. Pass a getter.                                     |
| Every file drops off `list_files` after a plain rebuild         | Seen twice on 2026-09-27 with an unchanged manifest: the rebuild closed the plugin in every open file instead of hot-reloading it. Ask for a relaunch per file.   |
| Plugin drops off `list_files` after a rebuild and never returns | Figma rejected the manifest (e.g. `dev` and `figjam` together in `editorType`) and closed the plugin. Fix it and relaunch from the Development menu.              |
| A regex or `\` in shipped source silently wrong                 | It was written through a shell heredoc or `bun -e`, which collapses `\\`. Write it with Edit/Write, use `String.raw` for `new RegExp`, check the compiled output. |

A rebuilt manifest's permissions **do** reach a hot-reloaded plugin, so a refusal path can be probed
by dropping the permission, rebuilding, and waiting for the reconnect.

Two things cannot be checked live on this machine, so do not plan either: Dev Mode (needs a paid
seat) and any team-library success path (needs an Organization or Enterprise plan and a published
library). Probe their refusal paths instead.
