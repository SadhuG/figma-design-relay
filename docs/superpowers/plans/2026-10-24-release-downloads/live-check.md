# Release downloads: live check

[← Overview](00-overview.md)

**Date:** 2026-10-24. **Candidate:** `dfeca2e` on `fix/releases` (version 0.11.1).

## Setup

- **Archive:** `figma-design-relay.zip` from Release dry run
  [`40056314790`](https://github.com/SadhuG/figma-design-relay/actions/runs/40056314790), built by
  CI from `dfeca2e`; `sha256sum -c SHA256SUMS.txt` → OK; `VERSION` reads `0.11.1`.
- **Server:** the archive's own `server/` run with plain Node and only its bundled
  `node_modules`: `FIGMA_DESIGN_RELAY_PORT=1996 node server/dist/index.js`. It logged
  `Leader listening on 127.0.0.1:1996` and `Became LEADER`.
- **Plugin:** the `releases` dev slot's build of the same commit, **Figma Design Relay (Dev:
  releases, port 1996)**, imported from `plugin/dist/manifest.json` in the Figma desktop app.
- **Why not the archive's plugin:** it has the stable id and dials 1994, where the user's stable
  relay was running. Its only differences from the tested build are the id and port, which
  `scripts/package-release.mjs` checks (`refuses a dev-slot build`, `…another port`, `…wrong id`).
- The stable relay on 1994 kept running throughout, untouched.

## Cases

| #   | Case                                                                                           | Result                                                                       |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Dashboard `http://127.0.0.1:1996/` served from the archive's `dashboard/`                      | HTTP 200, title "Figma Design Relay"                                         |
| 2   | Dev plugin in a design file ("Figma Design Relay")                                             | Chip **Live**, relay `ws://localhost:1996`                                   |
| 3   | Dev plugin in a FigJam board (new, "Untitled")                                                 | Chip **Live**, relay `ws://localhost:1996`                                   |
| 4   | `list_files` through a follower (`server/.smoke/call.mjs`, `SMOKE_PORT=1996`)                  | Both files, `editorType` `figma` and `figjam`                                |
| 5   | `get_metadata` per file through a follower                                                     | Design: 6 pages; FigJam: 1 page                                              |
| 6   | `get_node` (node-addressed) through a follower: design text node `118:1451`, FigJam page `0:1` | Both returned the node                                                       |
| 7   | `get_selection` (FigJam) through a follower                                                    | `[]` (nothing selected)                                                      |
| 8   | `run_script` (design) through a follower                                                       | `{"ok":true,…}`                                                              |
| 9   | `/api/status`                                                                                  | `version` `0.11.1`, port 1996, both files, five followers with one call each |

## Notes

- A first `get_node` on a whole wireframe page (`117:736`) hit the MCP client's request timeout.
  That is the size of the page, not the archive, so the case was re-run on a single text node.
- Figma automation could not type into the "Pick extension manifest file" dialog; the path was
  pasted into it from PowerShell instead (Alt+N, paste, Enter).
- A Slides tab that was already open showed "An error occurred while loading the plugin
  environment". Slides is not affected by this change and was not part of the check.
