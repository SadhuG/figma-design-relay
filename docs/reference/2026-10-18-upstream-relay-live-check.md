# Upstream relay integration — verification record (0.7.9)

The 0.7.9 integration of upstream `gethopp/figma-mcp-bridge` through v0.0.24 (`2c37e6d`): what was
merged, how it was checked automatically, and what was checked against real Figma. Spec:
[`../superpowers/specs/2026-10-18-upstream-relay-audit-design.md`](../superpowers/specs/2026-10-18-upstream-relay-audit-design.md).
Plan: [`../superpowers/plans/2026-10-18-upstream-relay.md`](../superpowers/plans/2026-10-18-upstream-relay.md).

## Candidate

- Branch `feat/upstream-relay-oct18`, from relay `55bd5ea` (0.7.8). The integration is a real merge
  with upstream `2c37e6d` as its second parent; red regression contracts were committed first.
- Dev slot `upstream-relay-oct18`, port 1998; Dev plugin "Figma Design Relay (Dev:
  upstream-relay-oct18, port 1998)", id `figma-design-relay-dev-upstream-relay-oct18`. The stable
  manifest keeps `[figma, figjam, slides]`.
- 64 MCP tools (54 before): `get_prototype_connections`, `trace_prototype_flow`, `create_svg`,
  `fit_to_content`, `distribute_horizontally`, `distribute_vertically`, `align_to_grid`,
  `place_below`, `place_right_of`, `duplicate_with_offset`.

## Automated verification

Run on the resolved candidate before the merge commit, Bun 1.4.0, Windows 11:

| Check                                      | Result                                 |
| ------------------------------------------ | -------------------------------------- |
| `bun run check` (root)                     | exit 0                                 |
| `bun scripts/check-version.mjs`            | `0.7.9`                                |
| server `bun test`                          | 384 pass, 2 skipped on Windows, 0 fail |
| plugin `bun test`                          | 322 pass, 0 fail                       |
| plugin `bun run typecheck`                 | zero errors                            |
| server and plugin builds                   | pass                                   |
| `bun run format:check`, `prettier docs/**` | pass                                   |
| `git diff --check`                         | clean                                  |
| old-name grep over `plugin` and `server`   | no hits                                |

Baseline before any change (`55bd5ea`): server 327 pass / 2 skip, plugin 218 pass, all checks green.

## Live Figma checks

**Status: design editor passed (28/28); FigJam and Slides not run — blocked, see below.** The live
gate is therefore not satisfied for FigJam and Slides.

### Tested build

| Item                        | Value                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Source                      | `6668ce3` (merge `6636f5e` plus the clone fix found here)                                             |
| `server/dist/index.js`      | sha256 `61b5361b440e3bc4ee33b1a436543e00f3728d9b669f08336e35d3d92687bcc5`                             |
| `server/dist/**/*.js`       | sha256 of the sorted concatenation `35d91e04d5fe88fb1f5fe9742c7969b3666a3dab768ae4067453c3e97b8045ff` |
| `plugin/dist/code.js`       | sha256 `b8deb8bf33252840aa00feaac778d65176da7b2dfef1ca414ef07feb02ed3c3b`                             |
| `plugin/dist/manifest.json` | sha256 `1a061ff39e49a7d135152ad98d93e158ace969210832eed629b96afd28a8b9f3`                             |

The server build did not change after the merge; the plugin was rebuilt once for the fix, the Dev
plugin relaunched, the fixtures recreated and the whole design run repeated on that build. A
`bun run check` rebuild of `6668ce3` reproduced the same `code.js` hash.

### Setup

- Figma desktop, Windows 11, Free plan. The Dev manifest was imported from
  `plugin/dist/manifest.json` ("Figma Design Relay (Dev: upstream-relay-oct18, port 1998)") and
  launched in the design file "Figma Design Relay" (`editorType: figma`, session key
  `unsaved-mvcxswvb-ul45oiea`). The stable plugin was relaunched there afterwards.
- Candidate leader: `server/.smoke/hold-leader.mjs` on `127.0.0.1:1998`. Every call came from a
  second candidate server that lost the election and reported `role: FOLLOWER`, so every
  node-addressed call crossed the follower → leader `/rpc` hop and `validateRpc`.
- Fixtures: two scratch pages and one variable collection named `zz relay live check 2026-10-18 …`,
  built with `run_script`; the user's three pages were never the target of a write. Cleanup removed
  exactly those pages and the collection, and a scan of every page found no `zz ` node left.

### Design-editor results (all through the follower)

| Case                                                                                                                                                                                          | Result         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `get_prototype_connections` on a screen: destinations resolved with screen and page; a destination inside a SECTION resolves to its screen; URL action kept; instance sublayer `I…;…` flagged | pass           |
| `maxNodes: 1` → `nodesScanned 1`, `truncated true`                                                                                                                                            | pass           |
| Page root: page scanned, OVERLAY destination carries its overlay settings                                                                                                                     | pass           |
| `includeEmpty` lists the screen itself                                                                                                                                                        | pass           |
| Document root `0:0` refused with a next step                                                                                                                                                  | pass           |
| `get_node` `includePrototype` adds `prototype`; plain `get_node` unchanged                                                                                                                    | pass           |
| `trace_prototype_flow`: A (0) → B, C (1) → overlay (2); B → A marked `revisit`; URL edge listed                                                                                               | pass           |
| `maxScreens: 1` → B and C in `pending`, `truncated`                                                                                                                                           | pass           |
| A page as trace start refused                                                                                                                                                                 | pass           |
| `create_svg` inline with XML declaration and comment, `parentId`, x/y, width only → FRAME, 2 vector children, 80×20 (height kept)                                                             | pass           |
| `create_svg` from a workspace file (`icons/live.svg`)                                                                                                                                         | pass           |
| `create_svg` with a bad parent → error, no orphan on the current page                                                                                                                         | pass           |
| `create_svg` `../outside.svg` and an https URL refused before the plugin                                                                                                                      | pass           |
| `set_node_properties` `nodeIds` batch → `updatedCount 2`; single `nodeId` keeps its old result                                                                                                | pass           |
| Batch with a missing id → error naming it, first node's x unchanged                                                                                                                           | pass           |
| `distribute_horizontally` x [0, 20, 100] widths [10, 20, 30] → gap 35, middle x 45, ends fixed                                                                                                | pass           |
| `align_to_grid` (-14, 16) on 10 → (-10, 20)                                                                                                                                                   | pass           |
| `place_below` gap 5 centre → (110, 165); `place_right_of` gap 5 → (135, 150)                                                                                                                  | pass           |
| `duplicate_with_offset` (5, −3) → copy in the original's frame at (105, 147)                                                                                                                  | pass after fix |
| `duplicate_nodes` of an off-page node → copy stays in its frame                                                                                                                               | pass after fix |
| Refusals: mixed parents, rotated node, auto-layout children — each with its reason                                                                                                            | pass           |
| `fit_to_content` padding 20 → section 240×340, child moved to (20, 20), origin kept                                                                                                           | pass           |
| `create_section` in a design file with parent page, fill, opacity, hidden contents                                                                                                            | pass           |
| `set_auto_layout` on a section refused with a reason                                                                                                                                          | pass           |
| Regression: `get_design_context` returns text plus an image block                                                                                                                             | pass           |
| Regression: serialized instance still carries `design.mainComponent`                                                                                                                          | pass           |
| `create_sticky` refused in a design file, naming FigJam                                                                                                                                       | pass           |

### Found by the live check

`duplicate_with_offset` first put its copy on the user's current page: Figma parents the clone of
a node on another page under the current page. The stray copy (one rectangle created by this
check) was removed at once. Fixed in `6668ce3` with `keepBesideOriginal` for both
`duplicate_with_offset` and `duplicate_nodes`, test-first, then re-verified live above.

An operator slip during plugin launch also typed into the canvas and set the selected frame's
opacity to 18%; it was undone with two Ctrl+Z steps and confirmed back at 100% before continuing.

### Not constructible here

- **Conditional, Set Variable and Set Variable Mode actions** are refused by Figma on the Free plan
  ("You cannot use … with your current plan"), so their live resolution is unit-tested only.
- **Cross-page navigation** is refused by Figma ("destinations must be a different top-level frame
  on the same page"), so the cross-page trace path is unit-tested only. Pages created in this
  session are loaded, so the unloaded-page path is unit-tested only too.
- **A missing destination**: Figma drops a reaction when its destination is deleted, so
  `status: "missing"` could not be produced live.
- **Dev Mode** needs a paid seat and is absent from the manifest; its gates are unit-tested.

### Blocker: FigJam and Slides

No FigJam board or Slides deck was open in Figma desktop — every open tab was a design file — and
creating one means making new files in the user's account (a Free plan also caps FigJam files), which
this run did not do without the user's say-so. So these required checks have **not** run:

- FigJam: sticky/shape text and style edits through `set_text_content` / `set_text_properties`;
  the extended `create_sticky`, `create_shape_with_text`, `create_section` and
  `create_connector` (floating, mixed and anchored ends, labels, self-loop, local coordinates
  inside a section); `get_styles` / `get_variable_defs` notes; layout helpers on board nodes;
  `fit_to_content`; `generate_diagram` regression; prototype and `create_svg` refusals.
- Slides: layout helpers and batches inside a slide; `set_text_content` on slide text with
  `set_text_properties` refused; prototype, `create_svg` and `fit_to_content` refusals.

To finish: open one FigJam board and one Slides deck in Figma desktop, run the Dev plugin in each,
hold the candidate leader (`node .smoke/hold-leader.mjs` in `server/`) and repeat the cases above
for those editors through a follower. A PR needs these results or an explicit user exception.
