# Release downloads: live check

[← Overview](00-overview.md)

## Stable port, archive's own plugin (the gate)

**Date:** 2026-10-24. **Candidate:** `f61659a` on `fix/releases` (version 0.11.1). This answers
review round 1's finding 3: the archive's stable-id plugin on 1994, not a dev-slot build.

### Setup

- **Archive:** `figma-design-relay.zip` from Release dry run
  [`40067598253`](https://github.com/SadhuG/figma-design-relay/actions/runs/40067598253), built by
  CI from `f61659a`; `sha256sum -c SHA256SUMS.txt` → OK; `VERSION` reads `0.11.1`; the plugin's
  manifest id is `figma-design-relay` and `dist/index.html` dials only `ws://localhost:1994/ws`.
- **Port 1994 freed first:** the user closed their MCP clients; the last stable relay (this
  session's) was stopped and 1994 had no listener.
- **Server:** the archive's own `server/`, run as a user would: `node server/dist/index.js` from the
  unzipped folder, Node 24.20, Bun removed from `PATH`, no `FIGMA_DESIGN_RELAY_PORT`. With no
  `.dev-slot.json` in the archive it chose 1994 itself and logged `Leader listening on
127.0.0.1:1994` and `Became LEADER`.
- **Plugin:** the main checkout's stable import was removed and the archive's `plugin/manifest.json`
  imported in the Figma desktop app (`%APPDATA%\Figma\settings.json` confirmed the swap), so the only
  plugin with id `figma-design-relay` was the archive's.
- **Follower calls:** `server/.smoke/call.mjs` and `port.mjs` copied into the unzipped archive's
  `server/` (scratch copy, not shipped), `SMOKE_PORT=1994`, so every follower was the archive's own
  server under plain Node.

### Cases

| #   | Case                                                                                      | Result                                                               |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Dashboard `http://127.0.0.1:1994/` from the archive's `dashboard/`                        | HTTP 200                                                             |
| 2   | Archive plugin in a design file ("Figma Design Relay")                                    | Connected, chip **Leader · 1 follower**, relay `ws://localhost:1994` |
| 3   | Archive plugin in a FigJam board ("Untitled")                                             | Connected, chip **Leader · 1 follower**, relay `ws://localhost:1994` |
| 4   | `list_files` through a follower                                                           | Both files, `editorType` `figma` and `figjam`                        |
| 5   | `get_metadata` per file through a follower                                                | Design: 6 pages; FigJam: 1 page                                      |
| 6   | `get_selection` (FigJam) through a follower                                               | `[]` (nothing selected)                                              |
| 7   | `run_script` (design) through a follower                                                  | `{"ok":true,"value":{"page":"Landing page wireframe",…}}`            |
| 8   | `get_node` (node-addressed) through a follower: design text `118:1451`, FigJam page `0:1` | Both returned the node                                               |
| 9   | `/api/status`                                                                             | `version` `0.11.1`, port 1994, both files, calls from followers      |

### Notes

- The chip reads **Leader · N followers** rather than **Live** whenever a follower is attached
  (`plugin/src/ui/panel-state.ts`); one stray client relay had rejoined as a follower. Both are
  the connected state.
- A first `get_node` sent the id as `nodeIds`; the tool's schema takes `nodeId`, and the retry
  with `nodeId` passed. Not an archive issue.
- Restore: the archived leader was stopped (a stable follower took over 1994), the archive's
  import removed and the main checkout's `plugin/manifest.json` re-imported.

## Earlier run: dev port 1996 (superseded)

`dfeca2e`, dry run [`40056314790`](https://github.com/SadhuG/figma-design-relay/actions/runs/40056314790):
the archive's server under plain Node with `FIGMA_DESIGN_RELAY_PORT=1996`, driven by the `releases`
dev-slot plugin (same commit; differs only in id and port). Dashboard, both editors, `list_files`,
`get_metadata`, `get_node`, `get_selection`, `run_script` and `/api/status` all passed. It left
the archive's own plugin untested, which the run above covers.
