---
name: live-figma-check
description: Use when verifying a figma-design-relay change against a real Figma document, probing a tool through the smoke harness, or debugging a plugin that will not connect, returns bare token ids, or has vanished from list_files.
---

# Checking against a live Figma file

`server/.smoke/` drives real tool calls exactly as an MCP client would: `probe.mjs` runs
`run_script`, `call.mjs` runs any tool by name. **Read `server/.smoke/README.md` first** — it covers
the setups (join the client's relay, hold your own leader), how ports follow a worktree's dev slot,
reading the output, and diagnosing the wiring with `netstat`.

```bash
cd server && bun run build
node .smoke/probe.mjs 'return figma.currentPage.name;'
node .smoke/call.mjs get_selection
```

## The machine's setup

- **Stable on 1994, each feature worktree on its dev slot's port** (1995–2019; the `start-feature`
  skill). In a worktree the client's relay, the plugin build and the probes all read the slot, so
  test a change **from its worktree** against the **Dev** plugin — the stable one is still running
  `main`. `server/.smoke/port.mjs` is the harness's single source (`SMOKE_PORT`, else the slot,
  else 1994). Probes join the leader on that port as followers.
- The stable MCP entry is `mcpServers.figma-design-relay` in `~/.claude.json` and must point at the
  **main checkout's** `server/dist/index.js`; each live worktree adds
  `mcpServers.figma-design-relay-dev-<name>` pointing at its own. "Connection closed" at session
  start usually means an entry points somewhere that no longer exists — a worktree removed without
  removing its entry. The old `@gethopp/figma-mcp-bridge` entry (bound to `[::]`, it swallowed
  every probe) is gone — do not bring it back.
- Development-menu imports: exactly one **Figma Design Relay** (the main checkout's
  `plugin/manifest.json`) and one **(Dev: <name>)** per live worktree (its `plugin/dist/manifest.json`).

## Symptoms that cost real time

| Symptom                                                         | Cause and fix                                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin "running but not connected", no socket in `netstat`      | Nothing listens on the port it dials — usually a Dev plugin whose worktree has no MCP entry or relay running. Its panel's **Relay:** row says which port.         |
| Library tokens come back as bare ids; each lookup takes ~11 s   | The plugin was hot-reloaded after a rebuild, and a hot-reloaded sandbox cannot fetch library assets. Close the panel and run it again (~300 ms per lookup).       |
| A probe ignores a schema, leader or bridge change               | The leader still runs the `dist` it started from. Restart the client's relay; probe from a feature worktree, whose relay is its own.                              |
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
