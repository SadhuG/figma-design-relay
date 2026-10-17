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

The review fixes after this run were rechecked live on their own build; see
[Review-fix rerun](#review-fix-rerun-6881bc0) at the end.

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

## Review-fix rerun (6881bc0)

The [independent review](2026-10-18-upstream-relay-review.md) of `6574482` found three P2 defects
and two smaller issues. They were fixed test-first in `100adcb` (free connector ends on the
canvas), `fdb1c9b` (duplicate_nodes cleanup and instance refusal) and `6881bc0` (prototype scan
children, throwing lookups, SECTION trace start). This rerun covers the design-editor paths those
commits touch. The commits after `6881bc0` change only docs.

### Automated, on 6881bc0

| Check                                        | Result                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| server `bun test`                            | 384 pass, 2 skipped on Windows, 0 fail (640 expect)                                     |
| plugin `bun test`                            | 337 pass, 0 fail (849 expect); 13 new regression tests                                  |
| plugin `bun run typecheck`, both builds      | pass                                                                                    |
| `bun run format:check`, `check-version.mjs`  | pass, `0.7.9`                                                                           |
| `git diff --check`                           | clean                                                                                   |
| reviewer's `reproduce.ts`, inverted to fixed | exit 0: one children read, sync error kept, refusals, canvas ends (103, 204) (113, 214) |

The reviewer's original `reproduce.ts` now fails at its first old-behaviour assertion
(`childReads` 1, expected 2001), as it should. The inverted copy is
`%TEMP%/relay-fix-verify-6881bc0/verify.ts`, outside the repository.

### Tested build

| Item                        | Value                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Source                      | `6881bc0`                                                                                             |
| `server/dist/index.js`      | sha256 `61b5361b440e3bc4ee33b1a436543e00f3728d9b669f08336e35d3d92687bcc5`                             |
| `server/dist/**/*.js`       | sha256 of the sorted concatenation `4df6bd8ff4fdabdac64a9434903b5f89a60f0b0a43e7a2fa44b101b19c6e69eb` |
| `plugin/dist/code.js`       | sha256 `696200a90ebe7aba0bf790324713ecac9441a3f7adcd94135543ca02696e7970`                             |
| `plugin/dist/manifest.json` | sha256 `1a061ff39e49a7d135152ad98d93e158ace969210832eed629b96afd28a8b9f3`                             |

`server/dist/tools.js` changed (tool descriptions), so the aggregate server hash differs from the
first run; `index.js` and the manifest did not.

### Setup

- Figma desktop, Windows 11, Free plan, design file "Figma Design Relay". The Dev plugin "Figma
  Design Relay (Dev: upstream-relay-oct18, port 1998)" was launched fresh from Quick Actions after
  the rebuild (not hot-reloaded); its panel read **Relay: localhost:1998**. It replaced the stable
  plugin in that file for the run; the stable plugin was relaunched there afterwards and showed
  **WebSocket Connected** on 1994. The stable relay process was not touched.
- Candidate leader: `server/.smoke/hold-leader.mjs` on `127.0.0.1:1998`, stopped afterwards. Every
  call came from a second candidate server; one started the same way printed
  `Starting MCP server (role: FOLLOWER)`, so every call crossed the follower → leader `/rpc` hop.
- Fixtures: one scratch page `zz relay fix check 2026-10-18` with a frame and rectangle, a
  component and its instance (direct child, nested frame, nested leaf), a frame with 3,000
  rectangles, and a section holding two screens with a navigate reaction and a URL reaction. The
  first fixture script stopped part-way (Free plan: "You cannot create multiple actions on
  Reactions"); the second run removed that partial page and used one action per reaction. Cleanup
  removed the page; a scan of every page found no `zz ` node, and the user's current page kept its
  4 children.

### Results (all through the follower)

| Case                                                                                                                                                                                                                   | Result    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Premise of finding 3: `wide.children !== wide.children` in real Figma                                                                                                                                                  | true      |
| Premise of finding 2: an instance layer's clone lands on the current page, then `insertChild` into the instance throws "Cannot move node. New parent is an instance or is inside of an instance" (probe clone removed) | confirmed |
| `duplicate_nodes` of an off-page rectangle → copy in its frame at the original's (30, 40)                                                                                                                              | pass      |
| `duplicate_nodes` of an instance's direct child, and of a leaf in a frame nested in it → refused, naming the instance and "Duplicate the instance"                                                                     | pass      |
| `duplicate_nodes` batch [valid rectangle, frame inside an instance] → refused before any clone; no copy in the frame, on the scratch page or the current page                                                          | pass      |
| `duplicate_with_offset` of an instance child → refused up front                                                                                                                                                        | pass      |
| Regression: `duplicate_with_offset` (5, −3) of the off-page rectangle → copy in its frame at (35, 37)                                                                                                                  | pass      |
| `get_prototype_connections` on the 3,000-child frame, `maxNodes 1` → `nodesScanned 1`, `truncated true`; ~0.5 s wall including server start                                                                            | pass      |
| Same frame, default budget → `nodesScanned 3001`, `truncated false`                                                                                                                                                    | pass      |
| `trace_prototype_flow` from the wide frame, `maxNodesPerScreen 1` → one screen, `truncated true`                                                                                                                       | pass      |
| `trace_prototype_flow` from the SECTION → refused: "not a section. Pass one of its screens"                                                                                                                            | pass      |
| `trace_prototype_flow` from a button in a screen inside the section → S1 (0) → S2 (1); edges `screen` to S2 and `url`; nothing unresolved                                                                              | pass      |
| `get_prototype_connections` on the section, `maxNodes 3` → S1, then its button, in layer order; `truncated true`                                                                                                       | pass      |
| Regression: `get_node` `includePrototype` → `prototype` with `root`, `nodesScanned`, `truncated`, `connections`                                                                                                        | pass      |
| `create_connector` in a design file → refused, naming FigJam                                                                                                                                                           | pass      |

### Still not run live

- **The connector fix (finding 1)** changes FigJam only, and no FigJam board is open: every Figma
  tab on this machine is a design file. Its live check (free and mixed ends inside a moved, nested
  section, then moving the section and inspecting the ends) joins the FigJam blocker above. Unit
  tests cover translated, nested and rotated parents and mixed ends.
- **A throwing lookup (P3)** cannot be provoked in a valid document; it is unit-tested for node,
  variable and collection lookups, synchronous and asynchronous.
- **An insertion failure after a successful clone** cannot be produced live now that instance
  layers are refused first; the cleanup path is unit-tested.
- FigJam and Slides remain blocked exactly as recorded above.
