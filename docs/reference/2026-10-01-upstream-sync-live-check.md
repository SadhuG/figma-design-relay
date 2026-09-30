# Upstream sync 0.7.6: live Figma verification

Checked on 2026-10-01 (Asia/Calcutta) against main commit
`f82227074c6930adcbc63fe9a6d80109e576fdec`, which includes upstream through `e8db933`.
This is a retrospective check: PR #10 had already merged without live evidence. Future
changes that might affect behaviour in Figma must pass this gate before opening a PR
and before merging, as required by `.claude/CLAUDE.md`.

## Setup

- Built server and plugin from the main checkout. No tracked code changed during the checks.
- The old stable leader reported `0.7.5`; restarted it from the newly built
  `server/dist/index.js`. `/ping` then reported `0.7.6` on `127.0.0.1:1994`.
- Relaunched the stable **Figma Design Relay** development plugin in the design file
  and FigJam board. The user also connected a Slides test deck. All three editors
  accepted requests from the merged sandbox build.
- A scratch MCP client spawned the built server as a follower on port 1994. Its
  tool calls crossed the real HTTP `/rpc` leader hop and WebSocket to the plugin.
- Temporary frames, rectangles, imported layers, a FigJam section, a sticky and
  a shape-with-text were removed after the checks. No existing nodes were edited.

## Results

All 29 design, FigJam and Slides checks passed:

| Path                              | Live evidence                                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_layout_tree` in design files | Root, rotated rectangle and hidden rectangle returned; transforms, local sizes, layout bounds, render bounds, parent ids and visibility exactly matched reads from the live Plugin API.                                    |
| Capture metadata                  | Root id and containing page matched; the response declares screenshots non-atomic and dimensions not measured from an image.                                                                                               |
| Node budgets                      | Budgets 1 and 2 returned exactly that many nodes with `truncated: true`; the complete three-node tree at budget 3 returned `truncated: false`.                                                                             |
| Cross-page root                   | Reading a node on a loaded non-current page returned that page's id. The current page did not change.                                                                                                                      |
| Refusals                          | Page roots, missing scene nodes and a zero node budget returned MCP errors.                                                                                                                                                |
| Separate screenshot               | Exported the scratch root; decoded bytes had the PNG signature.                                                                                                                                                            |
| Async serializer                  | `get_design_context` on the scratch frame succeeded through the follower.                                                                                                                                                  |
| Corner radius                     | `set_node_properties` wrote a radius on a design rectangle successfully.                                                                                                                                                   |
| HTML importer                     | Imported a frame and child rectangle through `import_html_layers`; live dimensions were 120 × 90 and 33 × 44 respectively.                                                                                                 |
| FigJam geometry                   | Section, sticky and shape-with-text returned; their transforms and bounds exactly matched the live Plugin API. The section's containing page was correct.                                                                  |
| Sticky root                       | A standalone sticky returned successfully with the render-bounds field, including the fallback for APIs that do not expose it.                                                                                             |
| FigJam radius refusal             | A radius write to a shape-with-text still returned an MCP error.                                                                                                                                                           |
| Slides geometry                   | Both `SLIDE_GRID` and `SLIDE` roots returned successfully through the follower. Root/page ids and node budgets were correct; local sizes, transforms, layout bounds and render bounds exactly matched the live Plugin API. |

## Scope

No Dev Mode or team-library behavior changed in this sync; those paid-plan paths were
not part of these checks. Screenshots remain separate snapshots, and masks/painted
visibility are not evaluated by `get_layout_tree`.
