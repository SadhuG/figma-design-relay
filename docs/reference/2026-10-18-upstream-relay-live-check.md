# Upstream relay integration — verification record

The integration of upstream `gethopp/figma-mcp-bridge` through v0.0.24 (`2c37e6d`): what was
merged, how it was checked automatically, and what was checked against real Figma. Spec:
[`../superpowers/specs/2026-10-18-upstream-relay-audit-design.md`](../superpowers/specs/2026-10-18-upstream-relay-audit-design.md).
Plan: [`../superpowers/plans/2026-10-18-upstream-relay.md`](../superpowers/plans/2026-10-18-upstream-relay.md).

The original candidate below used the then-next version 0.7.9. That version was never released.
After incorporating the reviewed 0.8.0 panel and agent-name release and 0.8.1 DNS pinning fix, the integration candidate is
0.8.2. Historical build hashes and results below describe their named commits. The refreshed
candidate's affected live checks are recorded in [Integrated 0.8.2 rerun](#integrated-082-rerun-baeb3dd).

The unloaded-page-root gate was closed in the final section of this record. The remaining
unavailable live cases are Conditional, Set Variable and Set Variable Mode actions on the Free
plan. The user explicitly waived only those three live tests if the current Free plan prevents
them. Their automated tests and all other live checks, independent review, CodeRabbit review and
CI remain required. The refreshed candidate's affected live rerun passed as recorded below; this
narrow exception did not waive it. Historical statements below describe the approval state at the time.

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

**Status: design editor passed (28/28). FigJam and Slides were run later on the 6881bc0 build —
see [FigJam and Slides run](#figjam-and-slides-run-6881bc0). It found one FigJam defect
(`create_connector` drops `parentId` when one end is attached and the other is free). It was fixed
test-first with the `create_shape_with_text` default and rechecked live on its own build — see
[Mixed-end connector and shape default fix](#mixed-end-connector-and-shape-default-fix-3b91bed).**

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
  session are loaded, so the unloaded-page path is unit-tested only too. (Closed later: see
  [Unloaded non-current page roots](#unloaded-non-current-page-roots-af7f24e).)
- **A missing destination**: Figma drops a reaction when its destination is deleted, so
  `status: "missing"` could not be produced live.
- **Dev Mode** needs a paid seat and is absent from the manifest; its gates are unit-tested.

### Blocker: FigJam and Slides (lifted later)

Lifted once the user opened a board and a deck; the results are in
[FigJam and Slides run](#figjam-and-slides-run-6881bc0). As first recorded:

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

- **The connector fix (finding 1)** — run later; see
  [FigJam and Slides run](#figjam-and-slides-run-6881bc0). As first recorded: it changes FigJam
  only, and no FigJam board was open. Unit tests cover translated, nested and rotated parents and
  mixed ends.
- **A throwing lookup (P3)** cannot be provoked in a valid document; it is unit-tested for node,
  variable and collection lookups, synchronous and asynchronous.
- **An insertion failure after a successful clone** cannot be produced live now that instance
  layers are refused first; the cleanup path is unit-tested.
- FigJam and Slides: run in the next section.

## FigJam and Slides run (6881bc0)

Run after the user opened a FigJam board and a Slides deck. Live evidence only: no product code
changed and nothing was rebuilt.

### Tested build

The artifacts were the reviewed `6881bc0` build; `git diff 6881bc0 57e3f42` touches only
`.claude/` and `docs/`. Hashes taken before the run:

| Item                        | sha256                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `server/dist/index.js`      | `61b5361b440e3bc4ee33b1a436543e00f3728d9b669f08336e35d3d92687bcc5`                        |
| `server/dist/**/*.js`       | `4df6bd8ff4fdabdac64a9434903b5f89a60f0b0a43e7a2fa44b101b19c6e69eb` (sorted concatenation) |
| `plugin/dist/code.js`       | `696200a90ebe7aba0bf790324713ecac9441a3f7adcd94135543ca02696e7970`                        |
| `plugin/dist/manifest.json` | `1a061ff39e49a7d135152ad98d93e158ace969210832eed629b96afd28a8b9f3`                        |
| `plugin/dist/index.html`    | `5f32c50a019670112571bcf3449ba5e29caae671a9f5e23060ac8fbbacf8bad4`                        |

All four previously recorded hashes match the review-fix rerun above.

### Setup

- Figma desktop, Windows 11, Free plan. The Dev plugin "Figma Design Relay (Dev:
  upstream-relay-oct18, port 1998)" was running in four files. `list_files` through a follower
  returned `DS` and `Screen` (`figma`), `Untitled` (`figjam`, `unsaved-mvdep4x4-2s2g463p`) and
  `Untitled` (`slides`, `unsaved-mvdep8bc-qg1tc6ls`). Every call passed one of those keys
  explicitly.
- Candidate leader: the parent session's `node .smoke/hold-leader.mjs` (PID 7028,
  `127.0.0.1:1998 LISTENING`, four plugin sockets `ESTABLISHED`). It was left running. The stable
  relay on 1994 was not touched.
- Every call came from `server/.smoke/call.mjs` (`run_script` through the same harness for fixture
  setup and inspection). Its spawned server, started the same way by hand, printed
  `Became FOLLOWER` / `Starting MCP server (role: FOLLOWER)`, so every call crossed the follower →
  leader `/rpc` hop and `validateRpc`. The raw output is in `%TEMP%/relay-live-fjsl/`, outside the
  repository.
- Fixtures: on the board, the section `zz relay live check FJ 2026-10-18` and everything created
  inside it, plus whatever ended up at page level (the mixed connector `18:41` and the diagram
  `18:92`–`18:112`). In the deck, one new slide `zz relay live check SL 2026-10-18` (`13:4`)
  holding every Slides fixture. The user's slide `1:42` and its `Frame 2` (`1:43`) were only read.

### FigJam results (all through the follower)

| Case                                                                                                                                                                                                                               | Result     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `create_section` with name, x/y, size, fill `#E8F0FF` at 0.8; a nested `create_section` with `parentId` and `sectionContentsHidden: false` → both read back with those values                                                      | pass       |
| `create_sticky` with `parentId`, name, x/y; `characters` alias; `isWideWidth` → 416×240, `isWideWidth` true                                                                                                                        | pass       |
| `create_shape_with_text` DIAMOND 220×160 with label font Inter Bold 20, fill, stroke, stroke weight 3 and text colour → every value read back                                                                                      | pass       |
| `set_text_content` on a sticky (`text`) and a shape (`characters`) → outer id and name returned, `.text` changed                                                                                                                   | pass       |
| `set_text_content` on a sticky whose text mixes Inter Medium and Bold → edited                                                                                                                                                     | pass       |
| `set_text_properties` on a sticky: Inter Bold, size 24, fill `#1144AA` at 0.9, line height 30, letter spacing 1 → `applied` reports each                                                                                           | pass       |
| `set_text_properties` on a shape: size 28, fill `#006600`                                                                                                                                                                          | pass       |
| `set_text_properties` on a shape with `textAlignHorizontal` and `fontSize 40` → refused; read back, size still 16                                                                                                                  | pass       |
| `set_text_properties` with an unknown font → "could not be loaded"; label unchanged                                                                                                                                                | pass       |
| `set_text_content` / `set_text_properties` on a RECTANGLE → refused, naming the supported types                                                                                                                                    | pass       |
| `create_connector` both ends free, `parentId` section at (1000, 1000), local (100, 700)→(300, 750), label → in the section, canvas box (1100, 1700) 200×50                                                                         | pass       |
| Same in a nested section at canvas (1900, 1100), local (20, 20)→(200, 60) → canvas box (1920, 1120)                                                                                                                                | pass       |
| Both ends attached with `right`/`top` anchors, label, stroke weight 4 and `#AA00AA` → magnets RIGHT/TOP, stays in the section                                                                                                      | pass       |
| Self-loop on the diamond, `right`→`bottom`, label → both ends on the diamond                                                                                                                                                       | pass       |
| `startAnchor` with a free start → schema error naming `startNodeId`                                                                                                                                                                | pass       |
| Mixed ends: start on a sticky (`bottom`), free end at local (150, 1000), `parentId` the section → free end at canvas (1150, 2000), correct; **but the connector is on the page (`parentId` `0:1` in the result), not the section** | **defect** |
| Section moved (1000, 1000)→(1200, 1100), nested section moved +50 → free connectors' boxes move with them; `get_node` bounds stay parent-relative                                                                                  | pass       |
| Endpoint nodes moved → attached connector ends follow                                                                                                                                                                              | pass       |
| `get_styles` → empty arrays and three notes ("… could not be read in this FigJam board: not a function"); `get_variable_defs` → `collections: []` with a note                                                                      | pass       |
| `set_node_properties` `nodeIds` batch of two stickies → `updatedCount 2`; batch with `99:999` → "Node not found: 99:999", first sticky's x unchanged                                                                               | pass       |
| `distribute_horizontally` x [100, 420, 1000], width 240 → gap 210, middle x 550; `distribute_vertically` y [800, 850, 900], height 240 → gap −190, middle y 850                                                                    | pass       |
| Distribute refusals: a node in another section (different parent), a rotated shape                                                                                                                                                 | pass       |
| `align_to_grid` 25: (363, 812) → (375, 800)                                                                                                                                                                                        | pass       |
| `place_below` gap 10 centre → (100, 1050); `place_right_of` gap 20 → (360, 800); `place_right_of` a rotated shape → refused                                                                                                        | pass       |
| `duplicate_with_offset` (30, −20) of a sticky and a shape → copies in the section at (130, 780) and (330, 380)                                                                                                                     | pass       |
| `fit_to_content` nested section, padding 20 → 220×80, origin kept; on a sticky → refused                                                                                                                                           | pass       |
| `fit_to_content` with a rotated child → refused, section unchanged; after rotation 0, padding 40 → 1460×1310, origin kept, content at +40; free connectors moved with it                                                           | pass       |
| Regression: `generate_diagram` flowchart → SQUARE, DIAMOND, SQUARE and three connectors attached to the right shapes, labels "zz go", "zz yes", "zz no"                                                                            | pass       |
| `get_prototype_connections`, `trace_prototype_flow`, `get_node includePrototype`, `create_svg` → refused, naming the editor                                                                                                        | pass       |
| Plain `get_node` on a sticky → serialized with text and author                                                                                                                                                                     | pass       |
| `get_node` / `set_text_content` / `create_connector` with a missing id → "not found" errors within 1 s                                                                                                                             | pass       |

### Slides results (all through the follower)

Every fixture is a free node in the scratch slide `13:4`: rectangles `13:5`–`13:7`, a rotated
rectangle `13:8`, a text node `13:9` and an auto-layout frame `13:10` with three children.

| Case                                                                                                                        | Result |
| --------------------------------------------------------------------------------------------------------------------------- | ------ |
| `set_node_properties` `nodeIds` batch: opacity 0.5, corner radius 8 → `updatedCount 2`                                      | pass   |
| Batch with `99:999` → "Node not found: 99:999", first rectangle's x unchanged                                               | pass   |
| `distribute_horizontally` x [100, 300, 800] → gap 240, middle x 440; `distribute_vertically` → gap −25, middle y 125        | pass   |
| Refusals: rotated node; auto-layout children; a node in the user's slide (different parent)                                 | pass   |
| `align_to_grid` 20: (813, 167) → (820, 160)                                                                                 | pass   |
| `place_below` gap 10 centre → (460, 190); `place_right_of` gap 15 → (575, 120); `place_below` a rotated node → refused      | pass   |
| `duplicate_with_offset` (40, 200) of a rectangle and the text → copies in the slide at (480, 320) and (140, 600)            | pass   |
| `set_text_content` on slide text → edited                                                                                   | pass   |
| `set_text_properties` → refused: "requires design editor or FigJam"; text size still 40                                     | pass   |
| `get_prototype_connections`, `trace_prototype_flow`, `get_node includePrototype`, `create_svg` → refused, naming the editor | pass   |
| `fit_to_content` and `create_section` → refused: "requires design editor or FigJam"                                         | pass   |
| Plain `get_node` on slide text → serialized                                                                                 | pass   |
| `get_styles` / `get_variable_defs` → the deck's text styles and the "Light slides" collection                               | pass   |

### Plugin UI (design file "Screen")

Done with the mouse on the plugin panel only, after a window capture to find the button. No
keystrokes went to the canvas. The one shortcut used, Ctrl+Alt+P, was sent after clicking empty
Layers-panel space.

| Case                                                                                                                                                                               | Result |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Panel expanded: File, Selection, **Relay: localhost:1998**, badge **WebSocket Connected**                                                                                          | pass   |
| Minimize → the bar shows only the badge and a restore control; `figma.clientStorage` `ui-collapsed` is `true`                                                                      | pass   |
| `figma.closePlugin()` → `Screen` drops off `list_files`; Run last plugin (Ctrl+Alt+P) → the Dev plugin reopens **still collapsed**, connected, new key `unsaved-mvdf2jpz-e2od8dxj` | pass   |
| Restore → expanded panel again, `ui-collapsed` `false`; selection still empty                                                                                                      | pass   |

The **Disconnected** badge was not exercised: that needs the leader stopped, and the parent
session owns it.

### Defect found: mixed-end connector leaves its parent

`create_connector` with `parentId` and one end attached to a node and the other free returns
`parentId: "0:1"`. The connector sits on the page, not in the requested section. The free end's
canvas position is right; only the parent is wrong. The result reports the real parent, so it does
not mislead, but `parentId` is silently ignored.

Reproduced in raw Plugin API (`%TEMP%/relay-live-fjsl/fj-12.log`, scratch connectors removed):
appending to the section and then setting `connectorStart` to a node endpoint moves the connector to
the page as soon as that end is set. Setting both ends first and then calling `appendChild` keeps it
in the section. Free–free and node–node connectors stay in the section. This candidate is the first
version to accept mixed ends, so this is a candidate defect. It goes back to the parent for a
test-first fix and fresh review. The fix needs the mixed case rerun live. (Fixed and rerun: see
[the fix section](#mixed-end-connector-and-shape-default-fix-3b91bed). Setting both ends before
`appendChild` keeps the parent but not the geometry, so the fix anchors the free end instead.)

### Observations, not defects

- `create_shape_with_text` with no `shapeType` made an ELLIPSE. A bare `figma.createShapeWithText()`
  on the same board also gives ELLIPSE, so the default comes from Figma (likely the board's last
  shape), not from the relay. The candidate's tool description says "SQUARE (default)", and the
  schema has said "default SQUARE" since `3d97e2e`. The wording overstates what happens. It is
  passed to the parent with the defect above. (Treated as a defect and fixed: the tool now always
  sets `shapeType`.)
- The free end of a connector serializes as `connector.from` / `to` = the page id (`0:1`), because
  Figma reports the page as a free end's `endpointNodeId`. That serializer is unchanged from
  `main`.
- After its parent moves, a free end's `connectorStart.position` getter still returns the value set
  at creation, though the drawn connector moves with the parent (`absoluteBoundingBox`). Nothing in
  the relay reads that getter back.
- Three raw `run_script` lookups (`figma.getNodeByIdAsync` of a missing or just-removed id, two in
  FigJam and one in Slides) threw Figma's "Unable to establish connection to Figma after 10
  seconds" after ~11 s, while the design file answered `null` in 0.3 s. The same lookups a minute
  later returned `null` in 0–1 ms, and every relay tool's missing-id path answered "not found"
  within 1 s. The cause is intermittent and on Figma's side, so the throwing-lookup path (P3)
  still counts as unit-tested only.
- Removing a shape also removes connectors attached to it (Figma's behaviour). A cleanup script
  that then named such a connector stopped part-way; it was rerun.
- The wording "textAlignHorizontal only apply to TEXT nodes" reads ungrammatically ("applies").
  Cosmetic.

### Cleanup

- Board: the section `17:2` (with every fixture inside it) and the diagram shapes
  `18:92`–`18:100` were removed. Figma removed the page-level connectors `18:41` and
  `18:104`–`18:112` along with the shapes they were attached to. The board is back to 0 children with no `zz ` node. Selection is
  empty again and the viewport is back to centre (0, −0.71), zoom 0.707, as found.
- Deck: slide `13:4` removed. The grid again holds only row `1:46` with slide `1:42`. `Frame 2`
  (`1:43`) is unchanged at (128, 446) 1200×189, the selection is `1:42` again and the viewport is
  restored. No `zz ` node is left.
- Design file "Screen": no write. The plugin was relaunched once and left expanded and connected.
- The 1998 leader (PID 7028) is still listening, with the plugins in all four files connected.

### Still open after this run

- **The mixed-end connector defect** above. FigJam's live gate waits on its fix and a rerun of the
  connector cases. (Closed by the next section.)
- Unchanged from earlier and not constructible here: Conditional / Set Variable actions (Free
  plan), cross-page navigation, a missing destination, Dev Mode, a throwing lookup, and an insert
  failure after a clone.

## Mixed-end connector and shape default fix (3b91bed)

Two live findings from the run above, fixed test-first: `367920e` (`create_shape_with_text`
default), `750ee6e` (mixed-end connector parent) and `3b91bed` (error wording found by this rerun).

### Root cause

Probed in raw Plugin API on the board before any code changed (scratch nodes removed):

- **Each endpoint assignment can reparent a connector.** Once an end names a node, Figma moves the
  connector into the closest container its ends share; a bare `{ position }` counts as the page.
  Node + bare point in a section → page. Two nodes in a nested section, with the connector in the
  outer one → the nested section. Two bare points → no move.
- **Setting both ends, then `appendChild`, is not a fix.** It keeps the parent, but the connector
  keeps its old geometry shifted by the parent's offset: a both-free connector was drawn 1000 px
  off, and a mixed one stayed off until its sticky was moved. Re-appending after the ends does the
  same.
- **`{ endpointNodeId: parent, position }` works.** Figma reads the position in the parent's own
  coordinates (checked with a section at an offset, a nested section, a frame rotated −90° and a
  group), the connector stays in the parent, and the end moves with it.
- Both free ends keep `100adcb`'s canvas mapping; only a free end beside a node end is anchored.
  So no point is mapped twice. After the ends, stroke and label, the tool checks the parent and
  removes a connector Figma put elsewhere.
- `figma.createShapeWithText()` gave ELLIPSE (the toolbar's last shape) before and during the run.

### Automated, on 3b91bed

| Check                                       | Result                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| `bun run check` (root)                      | exit 0                                                     |
| server `bun test`                           | 384 pass, 2 skipped on Windows, 0 fail                     |
| plugin `bun test`                           | 341 pass, 0 fail (4 new tests; 6 seen failing before)      |
| plugin `bun run typecheck`, both builds     | pass                                                       |
| `bun run format:check`, `check-version.mjs` | pass, `0.7.9`                                              |
| `git diff --check 66fd2b7 HEAD`             | clean                                                      |
| `367920e` alone                             | dispatcher tests 47 pass (shape default without the other) |

The test fake now reparents a connector on each assignment the way Figma did, and draws a free end
shifted when the connector is appended after its ends are set. Red before the fix: the shape came
out ELLIPSE, and every mixed case reported parent `8:0` (the page).

### Tested build

| Item                        | sha256                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `server/dist/index.js`      | `61b5361b440e3bc4ee33b1a436543e00f3728d9b669f08336e35d3d92687bcc5`                        |
| `server/dist/**/*.js`       | `21afcc90047a7e9aa5dcf5b347012ebc08f797b4f3c816096c858a9a73095719` (sorted concatenation) |
| `plugin/dist/code.js`       | `ec9bdaf3d7645eabe1e27422246681bc639650e87e12613956afb2c6892aac3a`                        |
| `plugin/dist/manifest.json` | `1a061ff39e49a7d135152ad98d93e158ace969210832eed629b96afd28a8b9f3`                        |
| `plugin/dist/index.html`    | `5f32c50a019670112571bcf3449ba5e29caae671a9f5e23060ac8fbbacf8bad4`                        |

Only `server/dist/tools.js` (the `create_connector` description) changed on the server, so the
1998 leader (PID 7028) was not restarted: its schema, routing and validation are unchanged, and
each call's follower ran the new `dist`. Manifest and UI are unchanged.

### Setup

- Figma desktop, Windows 11, Free plan, FigJam board `Untitled`. After the rebuild the Dev plugin
  hot-reloaded in all four files. On the board it was then closed (`figma.closePlugin()`) and run
  again with Run last plugin, after clicking the board's tab; its panel read **Relay:
  localhost:1998** and **WebSocket Connected**. Key `unsaved-mvdfqnmv-gx6c1q2z`. An earlier pass
  on the `750ee6e` build (code.js `b645f0e5…`, key `unsaved-mvdfnpc5-ideajt6k`) found only the
  wording fixed in `3b91bed`; its fixtures were removed and every case below was rerun on `3b91bed`.
- Every call came from `server/.smoke/call.mjs` with that `fileKey`; the spawned server printed
  `Became FOLLOWER` / `Starting MCP server (role: FOLLOWER)`. Raw output is in
  `%TEMP%/relay-mixfix/`, outside the repository.
- Fixtures (`run_script`): section A `21:324` at (1000, 1000); inside it stickies S `21:326` and
  V `21:330`, nested section B `21:325` at A (800, 100) with stickies T `21:334` and T2 `21:338`,
  and frame F `21:342` at A (200, 1600) rotated −90° with sticky U `21:343`. Sticky P `21:347` on
  the page.

### FigJam results (all through the follower)

Free points are given relative to the parent; canvas positions are read back from
`absoluteBoundingBox`.

| Case                                                                                                                                                                                               | Result |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Mixed, node start S `bottom`, free end A (150, 1000), label "zz go", `#AA00AA`, weight 3 → parent A; free end at canvas (1150, 2000); magnet BOTTOM, label, stroke and weight read back            | pass   |
| Mixed, free start A (600, 1200), node end S `right` → parent A; free start at (1600, 2200); magnet RIGHT                                                                                           | pass   |
| Mixed in nested section B: node T, free end B (100, 500) → parent B; free end at (1900, 1600)                                                                                                      | pass   |
| Mixed, node T in B, free end A (1400, 1500), parent A → parent A; free end at (2400, 2500)                                                                                                         | pass   |
| Mixed in rotated frame F: node U `bottom`, free end F (450, 450) → parent F; free end at (750, 3050), F's transform                                                                                | pass   |
| Regression: both free in A, (100, 1400)→(300, 1450), label → parent A; box (1100, 2400) 200×50                                                                                                     | pass   |
| Regression: both attached S→V, `left`/`left` → parent A, magnets LEFT/LEFT; self-loop on V with label → RIGHT/TOP                                                                                  | pass   |
| Node–node T→T2 with parent A → refused: "Figma put the connector in zz mixfix live B (21:325), not in … (21:324) … Pass parentId 21:325, or move the endpoint nodes so 21:324 is …"                | pass   |
| Node P on the page + free end, parent A → refused, naming Page 1 (0:1)                                                                                                                             | pass   |
| Both refusals left no connector: 9 connectors on the board, none named c09 or c10                                                                                                                  | pass   |
| No parent, node S + free (900, −200) → parent `0:1`, free end at (900, −200)                                                                                                                       | pass   |
| Section A moved (+200, +100) → every measured connector in A, B and F (c01–c04, c06, c07, F's second) moves by (+200, +100); parents unchanged; the page connector's free end stays at (900, −200) | pass   |
| Sticky S moved +30 → attached ends follow (S's connectors widen or shift by 30), free ends stay put                                                                                                | pass   |
| `get_node` on the first mixed connector → `connector.from` S, `to` A (the anchor), text "zz go"                                                                                                    | pass   |
| `create_shape_with_text` without `shapeType`, in A and on the page → SQUARE both times (bare `createShapeWithText()` gave ELLIPSE just before)                                                     | pass   |
| `create_shape_with_text` `DIAMOND` → DIAMOND                                                                                                                                                       | pass   |
| Design file `DS`: `create_connector` refused, naming FigJam; Slides: `create_shape_with_text` refused, naming FigJam                                                                               | pass   |

The first mixed case's free point in F (100, 200) landed inside sticky U; the F case above was added
with a point clear of it.

### Cleanup

- Board: removed exactly the recorded scratch ids — the page connector `21:391`, the page shape
  `21:403`, sticky P `21:347` and section A `21:324` with everything inside it. The probe nodes
  from the root-cause step and the `750ee6e` pass were removed the same way. The board is back to 0
  children, no `zz ` node, empty selection, viewport centre (0, −0.71) at zoom 0.707 as first found.
- Design files and the deck: no writes. All four files are connected to the 1998 leader (PID 7028),
  which is still listening. The stable relay on 1994 was not touched.

### Still open

- The `create_connector` parent check refuses a node–node connector whose nodes sit deeper than
  `parentId`. Before this fix such a call succeeded (per the raw probe) with the connector in the deeper container and
  that id in `parentId`.
- Unchanged and not constructible here: Conditional / Set Variable actions (Free plan), cross-page
  navigation, a missing destination, Dev Mode, a throwing lookup, and an insert failure after a
  clone.

## Unloaded non-current page roots (af7f24e)

Closes the review's round 3 gap: a scan, trace or `get_node` that starts on a page the plugin has
not loaded yet, while the user stays on another page. No code changed: `af7f24e` is docs-only on
top of `3b91bed`.

### Tested build

The `3b91bed` build recorded above, unchanged: `plugin/dist/code.js` `ec9bdaf3…`,
`manifest.json` `1a061ff3…`, `index.html` `5f32c50a…`, `server/dist` `21afcc90…`, rehashed
before the run. The 1998 leader is now PID 11152 (`server/dist/index.js`), held by
`node .smoke/hold-leader.mjs` (PID 4176) from this worktree since 12:05 IST. It was left
running. The stable relay on 1994 was not touched.

### Setup

- Figma desktop, Windows 11, Free plan, design file `Screen`, with `DS`, a board and a deck also
  connected. The plugin's `dynamic-page` access means a page's children cannot be read until it is
  loaded.
- Fixture page `zz unloaded-root live check 2026-10-18` `21:5`, created with `run_script`. Frames
  A `21:6`, B `21:7`, C `21:8`; in A, rectangle `22:12` (On click → Navigate to B) and `22:13`
  (On click → URL `https://example.com/zz-unloaded`); in B, rectangle `22:14` (On click → Navigate
  to C); C itself has On click → Back. The first creation call ran in a hot-reloaded sandbox. It
  failed with "Unable to establish connection to Figma after 10 seconds" after the page, frames
  and rectangles `21:9`–`21:11` had already landed without reactions. After a relaunch, a second
  `run_script` removed those three rectangles and created `22:12`–`22:14` with their reactions.
- **A fresh sandbox per entrypoint.** Before each case the Dev plugin was closed in `Screen`
  (`figma.closePlugin()`), the Screen tab clicked and Run last plugin (Ctrl+Alt+P) sent. In the
  last two cycles, focus was checked first: Figma had to be the foreground window with the title
  `Screen - Figma`, or the helper stopped without sending keys. Each case used the new `unsaved-…`
  key from `list_files`.
- Every call went through a follower: a scratch MCP stdio client spawned this worktree's
  `server/dist/index.js` with `FIGMA_DESIGN_RELAY_PORT=1998` and an explicit `fileKey`. Each spawned
  server printed `Became FOLLOWER`. Raw output is in `%TEMP%/relay-unloaded/`, outside the
  repository.
- **Before each call**, a `run_script` survey read every page's children in the fresh sandbox.
  `Page 1` was readable. Reading `21:5`'s children threw "Cannot access property `children` on a
  page that has not been explicitly loaded". So the plugin's startup does not load every page.
  The current page was `0:1` `Page 1`.

### Results (all through the follower)

| Fresh key                   | Call                                                 | Result                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unsaved-mvdgd464-e9apq3hx` | `get_prototype_connections` `nodeId` `21:5` (page)   | pass: `page` and `root` are `21:5` PAGE, flow start `21:6` "Flow 1", 7 nodes scanned, not truncated; `22:12` → `21:7` resolved (screen and page `21:5`), `22:13` URL, `22:14` → `21:8` resolved, `21:8` Back |
| `unsaved-mvdgfoz5-lgqzqgvj` | `get_prototype_connections` `nodeId` `21:6` (frame)  | pass: `page` `21:5`, `root` `21:6`, 3 nodes scanned; `22:12` → `21:7` resolved on page `21:5`, `22:13` URL                                                                                                   |
| `unsaved-mvdgpgsh-joj0xy83` | `trace_prototype_flow` `nodeId` `21:6`               | pass: screens `21:6` (depth 0), `21:7` (1, via `22:12`), `21:8` (2, via `22:14`); edges screen, url, screen, back; `unresolved` empty, not truncated                                                         |
| `unsaved-mvdhbu87-11z0dcyx` | `get_node` `nodeId` `21:6`, `includePrototype: true` | pass: frame A with children `22:12`, `22:13` and their reactions; `prototype` root `21:6`, 3 scanned, `22:12` → `21:7` resolved on page `21:5`, `22:13` URL                                                  |
| `unsaved-mvdhcfpp-qgg83mng` | `get_node` `nodeId` `21:5`, `includePrototype: true` | pass: PAGE with children `21:6`–`21:8`; `prototype` root `21:5`, 7 scanned, the same four connections as the page scan                                                                                       |

**After each call**, the survey found `21:5` loaded (children readable). The current page was still
`0:1` `Page 1`, the selection empty and the viewport unchanged at centre (−44.04, 233.49), zoom
0.829. So the tools load the root's page themselves and never switch the user's page. A first
`get_node` attempt in the fourth sandbox sent `nodeIds` and was refused by the MCP schema
(`nodeId` required) before reaching the plugin. The page was still unloaded afterwards, and the
corrected call ran in that same sandbox.

### Cleanup

- `Screen`: one `run_script` checked that `21:5` had the recorded name and was not the current
  page, then removed it with its descendants `21:6`, `22:12`, `22:13`, `21:7`, `22:14`, `21:8`. A
  scan of every page found no `zz ` page or node. Only `0:1` `Page 1` is left, with its original
  children. Current page, empty selection and viewport match the values first found.
- `DS`: read-only scan, no `zz ` node. The board and deck were not written to.
- All four files are connected to the 1998 leader (PID 11152). The `Screen` key at the end is
  `unsaved-mvdhcfpp-qgg83mng`. No helper process from this run is still running.

### Still open

- Unchanged: Conditional / Set Variable / Set Variable Mode actions need a paid plan. Cross-page
  navigation, a missing destination, Dev Mode and injected faults stay unit-tested, as the round 3
  review accepts.

## Integrated 0.8.2 rerun (baeb3dd)

On 2026-10-18, after the reviewed panel/agent-name release and DNS pinning fix landed, the feature
branch merged `origin/dev` `ad22b46` in `3977337` and `origin/main` `6e18047` in
`baeb3dd1ca6dcfff943f00418c19a74560185f5e`. Both packages and this integration's changelog entry
are now **0.8.2**. The earlier 0.7.9 and provisional 0.8.1 integration versions were not released.
Upstream `2c37e6d` remains an ancestor. No runtime code changed during this live rerun.

### Build and automated verification

`bun run check` passed on the resolved integration: version 0.8.2; server **407 pass, 2 skip,
0 fail**, 409 tests across 28 files; plugin **380 pass, 0 fail**, 380 tests across 23 files;
server build, zero-error plugin typecheck, both plugin builds and repository formatting passed.
The server conflicts retain both SVG filesystem tests and the reviewed DNS transport suite.
The old `globalThis.fetch` body-timeout test was removed because DNS pinning now uses the native
transport, whose deadline is tested in `image-fetch.test.ts`. `tools.ts` retains the reviewed
`fetchImageBytes` import and call. Source for the panel, dev-slot UI definitions and agent-name
cleaning is identical to released `origin/main`; the panel release's live evidence remains in
[`../superpowers/plans/2026-10-18-panel-redesign/live-check.md`](../superpowers/plans/2026-10-18-panel-redesign/live-check.md).

SHA-256 hashes, checked before and after the live calls:

| Artifact                                      | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `server/dist/index.js`                        | `fecccbd1edb82441e7aada4aeee40168ca26afa22b79eab2c3ca18636e12ad04` |
| Sorted concatenation of `server/dist/**/*.js` | `f568e6b51ba027c834817255d4b066f04f66e0ec7dd361093a44938e0b1b0c13` |
| `server/dist/image-fetch.js`                  | `96cce6832ff0acd7cc9682d9dde4325b69a0529cc28fc9a9cfb332b7a1723c96` |
| `plugin/dist/code.js`                         | `f3a2ec802b696e51ccb369af346253e51d379cfc4149c3ec6517c51b65e614e1` |
| `plugin/dist/manifest.json`                   | `1a061ff39e49a7d135152ad98d93e158ace969210832eed629b96afd28a8b9f3` |
| `plugin/dist/index.html`                      | `3547fc127c3f968ba6f512ff8ee82d47c69c038e505b420f4959c4729e677a1f` |

### Setup and results

The old worktree-specific 1998 holder and child were identified by command line and replaced with
the current build. Hidden holder PID 32512 runs `server/.smoke/hold-leader.mjs`, listening only on
`127.0.0.1:1998`; its logs are `%TEMP%/relay-upstream-holder.out.log` and `.err.log`. The user
launched the rebuilt **Figma Design Relay (Dev: upstream-relay-oct18, port 1998)** plugin in each
editor after the final build. The stable relay and global MCP configuration were untouched.

The temporary MCP harness `%TEMP%/upstream-integrated-live.mjs` starts this worktree's built server
as a stdio client named `upstream-integrated-live` 0.8.2. Each editor run recorded `Became FOLLOWER`
and `Starting MCP server (role: FOLLOWER)`. Every tool received its explicit `fileKey`, so all
node-addressed families crossed the actual `/rpc` validation path. Raw results, fixture IDs,
state snapshots and role lines are in `%TEMP%/upstream-integrated-live/`; command summaries are
`%TEMP%/upstream-integrated-{design,figjam,slides}.log`.

| Editor / session                                          | Results on this build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design, `Figma Design Relay`, `unsaved-mve1h35y-nus0llh6` | **27 calls passed**, including setup/inspection/cleanup. Two-node property batch; grid; horizontal/vertical distribution; below/right placement; duplicate offset preserving parent; rotated placement refusal; ordinary enriched `get_node`; prototype scan, bounded scan, `get_node includePrototype` and trace with resolved navigation destination; inline and workspace-file SVG with editable children, width-only resize and invalid-parent refusal; remote DNS-pinned `create_image` success (32 × 32), internal-loopback refusal; text edit; `get_design_context` with an actual image block; section creation and fitting.                           |
| FigJam, `Untitled`, `unsaved-mve1nrxz-qxh46q8g`           | **34 calls passed**, including setup/inspection/cleanup. Property batch and all applicable layout helpers; rotated placement refusal; ordinary `get_node`; prototype/SVG editor refusals; wide sticky and styled shape aliases, label content and font size edits; omitted shape type observed as `SQUARE`; mixed node/free, free/free, attached node/node and self-loop labelled connectors; mixed connector retained its section parent and its free end used the section anchor; style/variable reads returned explicit availability notes; section fit; `generate_diagram` produced two shapes and one labelled connector with both attached endpoint IDs. |
| Slides, `Untitled`, `unsaved-mve1nwcn-wu9oyecs`           | **22 calls passed** in the final complete run, including setup/inspection/cleanup. Property batch, grid, distribution, relative placement, duplicate offset, rotated placement refusal, ordinary `get_node` and text edit; prototype reads, SVG, text styling, section creation/fitting and FigJam shape creation returned the expected editor refusals.                                                                                                                                                                                                                                                                                                       |

These are affected integration reruns, in addition to the detailed historical matrices above.
Unchanged unloaded-page-root, cross-page/invalid-destination and injected-fault coverage retains
the earlier evidence and round 3 review's scope; it is not newly claimed as replayed here.

### Cleanup and harness corrections

- Design scratch page `45:1240` and all descendants, including clone, SVGs, image and section,
  were removed. An earlier harness assertion incorrectly expected grid snapping to refuse a
  rotated node; the documented grid contract allows rotation. Its scratch page `45:1230` was
  also removed in `finally`; the corrected final run tested the intended rotated **placement**
  refusal. No product code changed. Current page `6:5437`, original empty selection and root
  IDs were preserved. A later survey found no `zz upstream` pages or variable collections.
- FigJam scratch section `23:2` and its descendants were removed; diagram nodes `23:42`,
  `23:46` and `23:50` were separately inspected and removed. Original current page `0:1`,
  empty selection and empty root list were restored.
- Slides automatically names a new slide numerically, so the first cleanup's expected custom
  name did not match. Read-only inspection confirmed recorded scratch slide `18:4`, type
  `SLIDE`, parent `1:46` and its exact six marked scratch children. A guarded cleanup removed
  that ID and restored selection `1:42` and viewport. The final complete rerun used the correct
  slide identity guard and removed its scratch slide `18:12`. The original root list `0:3`
  was preserved. No user slide or node was removed. Viewport centers can round by less than
  0.001 canvas units when restored; zoom was unchanged.
- The temporary workspace SVG was removed. No MCP configuration, plugin import or stable relay
  was edited. The current 1998 holder remains running for review follow-up.

### Narrow paid-action exception

The user explicitly authorized skipping live success tests **only for Conditional, Set Variable
and Set Variable Mode if the current Free plan prevents them**. Fresh individual
`setReactionsAsync` attempts on this candidate returned, respectively, "You cannot use Conditional
actions in Reactions with your current plan", "You cannot use Set Variable actions in Reactions
with your current plan", and "You cannot use Set Variable Mode actions in Reactions with your
current plan". The follower result is in `%TEMP%/upstream-paid-check.log`. Scratch page `45:1256`
and collection `VariableCollectionId:45:1258` were removed in `finally`; the later survey confirms
no matching scratch page or collection remains.

That exception applies to those three live success paths alone. Their automated tests passed
with the full suite. All other live checks, latest-head independent review, completed CodeRabbit
review and successful CI remain required. This record does not approve or merge a PR.
