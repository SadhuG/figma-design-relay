# Independent upstream relay review - 2026-10-18

**Verdict: changes requested before PR.** Three P2 defects reproduced; one lower-confidence
runtime robustness issue is recorded separately. FigJam/Slides live verification remains an
independent PR gate. No critical defect found.

Reviewed `55bd5eaf93696049fc1550d1893b38a5d81dfa0b..6574482c6930ca0bbda899fd84ff7033959ed957`,
including all upstream additions, conflict resolutions and `6668ce3`. The worktree was initially
clean. Local `origin/dev`, and a read-only `git ls-remote origin` check of both dev/main, still
point to `55bd5ea`; `origin/dev...HEAD` is the same diff. Merge `6636f5e` has parents
`e23100b507488ba1496eee37e3fa881ccd95a48f` and `2c37e6dc3d2ccd903c98c4a6660a3c9c94cc447f`.

## Verified defects

### 1. P2 - Free connector endpoints are not converted to canvas coordinates

Location: `plugin/src/main/code.ts:2214` (through line 2221). Related regression:
`plugin/src/main/dispatcher.test.ts:780`.

Trigger: `create_connector` with a floating start/end and a `parentId` whose canvas origin is
not zero. The tool promises parent-relative input but passes that input directly as
`ConnectorEndpoint.position`. Figma defines an unattached endpoint in canvas coordinates;
appending the connector first does not convert a subsequently assigned point. See the
[official endpoint contract](https://developers.figma.com/docs/plugins/api/ConnectorEndpoint/).

The actual dispatcher, under an isolated API double, accepted a section at `(100,200)` with
`startX:3,startY:4` and passed `(3,4)` to the endpoint setter; the promised position is
`(103,204)`. Both-free and mixed connectors can therefore be drawn far outside the section.
This verifies the API-contract mismatch; no live FigJam rendering was performed in this review.

Direction: convert each free point through the final parent's `absoluteTransform` (identity
for a page). Keep attached IDs/magnets unchanged. Replace the test that merely asserts raw
`(3,4)` assignment with canvas-position assertions for translated/nested parents and mixed
endpoints. The required FigJam live check should also move the section and inspect the ends.

### 2. P2 - The duplicate fix leaves an unreported clone when reparenting fails

Location: `plugin/src/main/code.ts:1708` (through line 1710), calling
`plugin/src/main/layout-actions.ts:274`.

Trigger: an original has a parent into which Figma will not insert a new child, such as an
instance or a container inside an instance. `clone()` creates the copy on the current page;
the new `keepBesideOriginal` call then throws. `duplicate_nodes` has no cleanup around this
new failure point, so it returns an error while leaving the copy in the user's document, with
no returned ID. The reparenting restriction is documented under
[insertChild](https://developers.figma.com/docs/plugins/api/properties/nodes-insertchild/).

An isolated invocation of the actual dispatcher with an instance-parent insertion refusal
returned that refusal and left one surviving clone. The same fixture through
`duplicate_with_offset` removed its clone correctly. The existing successful off-page test
does not cover this regression introduced by `6668ce3`.

Direction: preflight known restricted parents and protect clone/reparent with cleanup, at
least removing the just-created copy when it cannot be returned. Decide explicitly how to
preserve the old handling of instance sublayers. Test an instance child, a frame nested in an
instance, an insertion failure, and successful off-page placement/coordinates. No real Figma
instance was modified to reproduce this finding.

### 3. P2 - Prototype traversal repeatedly materializes the children array

Location: `plugin/src/main/prototype.ts:260`.

Figma's `children` getter returns a fresh array on every access, as the
[official children documentation](https://developers.figma.com/docs/plugins/api/properties/nodes-children/)
explains. Reading `node.children[i]` separately for every child makes expansion of a container
with N direct children quadratic in array-copy work. It expands the entire sibling list even
after the requested scan budget has been consumed.

An API-faithful getter double with 2,000 children and `maxNodes:1` reproduced 2,001 getter calls
and 4,002,000 copied references while reporting one scanned node. At 50,000 children that
pattern implies approximately 2.5 billion copied references. Wide real files can stall even a
deliberately tiny scan or trace. Existing tests return the same array and hide this cost.

Direction: cache `children` once per expanded container; preferably use traversal cursors so
the node budget also avoids eagerly pushing every sibling. Preserve visit order and exact
`truncated` behavior. Add a getter-count regression with a wide page and a tiny budget, and
exercise the same path through `trace_prototype_flow`.

## Additional robustness observations

- `plugin/src/main/prototype.ts:206`: `load(id).then(...)` catches rejected promises but not a
  synchronous throw while calling the injected lookup. A non-async lookup that throws caused
  the whole scan to reject, losing an unrelated URL action, instead of producing a reference
  error/null metadata. This helper behavior is verified; whether the relevant live Figma
  bindings throw synchronously on an otherwise valid document was not established. Treat as
  P3 hardening: wrap invocation in a promise/try-catch and test synchronous as well as async
  failures for node, variable and collection lookups.
- `plugin/src/main/prototype.ts:275`: a SECTION trace start is accepted and represented as a
  screen, attributing its contained frame's edges to the section. Reproduced, but a SECTION
  start is outside the advertised "screen or node inside one" input contract. An explicit
  refusal would improve invalid-input behavior; this is not a valid-input release blocker.

## Plan fulfillment and retained contracts

All seven change groups and ten new tools are present. The 64 registrations are unique; new
schemas, RPC mappers, handlers, transport IDs/fileKey, dispatcher cases and capability entries
are wired. Canonical labels, singleton batch output, paired legacy creator dimensions,
async enriched serialization and the existing codegen/library/search/diagram paths survive.
The loopback host, Origin/content-type guards, private packaging, relay names, release workflow
and stable `[figma, figjam, slides]` manifest are retained. The unchanged protected files were
compared against the base. SVG containment, descriptor identity checks, byte caps and cleanup
are covered by the passing suite; no confirmed escape was found.

The extracted injectable modules and schema/follower tests are useful. The main test gaps are
the documented Plugin API semantics behind findings 1-3. The RIGHT/TOP self-loop decision,
empty omitted labels and error-versus-missing destination distinction were reviewed as the
accepted decisions in the brief, not reported as defects. Task 8 remains incomplete because
required live editor coverage is missing.

## Verification performed by this reviewer

- Server `bun test`: **384 pass, 2 Windows skips, 0 fail**, 640 assertions, 26 files.
- Plugin `bun test`: **324 pass, 0 fail**, 807 assertions, 22 files.
- Plugin `bun run typecheck` and server `bunx tsc --noEmit -p tsconfig.json`: exit 0.
- Root `bun run format:check`, `bun scripts/check-version.mjs` (`0.7.9`) and
  `git diff --check`: pass before adding this report. Product old-name grep: no hits.
- Existing `server/dist/index.js`, `plugin/dist/code.js` and `plugin/dist/manifest.json`
  hashes match the three individual hashes in the live record. The aggregate server hash and
  the original live run were not independently replayed.
- Isolated reproduction command, run from the worktree root:
  `bun C:/Users/sadhu/AppData/Local/Temp/relay-review-6574482/reproduce.ts` (exit 0). This scratch
  script imports the real helpers/dispatcher with doubles and asserts the observed failures;
  it is outside the repository and does not access Figma.

No product files, index, commits or branches were changed. No plugin rebuild, Figma mutation,
merge, push or PR was performed. Only this permitted review report was added.

## Live gates and evidence limits - separate from defects

The live record explicitly reports Design 28/28, not cross-editor completion. Its automated
table's 322 plugin tests describes the pre-fix merge; the current suite has 324. That historical
count is not a failing check. The current individual artifact hashes corroborate build identity,
not the truth or completeness of every reported live assertion.

FigJam and Slides paths remain unverified and block PR unless the parent obtains the specific
exception required by the repository's live-check rules. Conditional/variable/mode actions,
unloaded/cross-page paths, deleted destinations and Dev Mode have the documented Free-plan,
API or manifest limitations; these are not new code defects. The design table also does not
explicitly evidence every planned regression, including UI collapse/reconnect. Resolve that
coverage with the live matrix rather than interpreting "28/28" as the entire plan passing.

After fixes, repeat affected automated/live checks and obtain a new independent review before
PR. Pre-existing DNS-rebinding/WebSocket-origin concerns, broad XML sanitization, slide
structure creation and prototype condition simulation were not expanded into this review:
they are explicitly excluded from this integration's scope.

## Responses - fix round on 6574482

Added by the implementing agent after the review; everything above is the reviewer's original
report, unchanged (sha256 `dfbdb42b…5b535` before this section). Each finding was checked against
Figma's documentation, the code and, where possible, real Figma before anything changed. Every
fix is test-first: the new tests failed for the reported reason before the fix. Live evidence is
in [the integration record](2026-10-18-upstream-relay-live-check.md#review-fix-rerun-6881bc0).

| Finding                                   | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Commit    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1. P2 free connector ends                 | **Confirmed and fixed.** The ConnectorEndpoint page calls an unattached `position` a "location on the canvas". `toCanvasPoint` maps each free point through the final parent's `absoluteTransform`; a page parent (or none) is the identity. Attached ends and magnets are unchanged. The test that pinned raw `(3,4)` now expects `(103,104)`; new tests cover a rotated frame nested in a section, a page parent, and a node start with a free end. Live FigJam check still blocked (no board open). | `100adcb` |
| 2. P2 unreported clone in duplicate_nodes | **Confirmed live and fixed.** In real Figma an instance layer's clone landed on the current page and `insertChild` into the instance threw. `duplicate_nodes` now checks every node before its first clone, refuses layers anywhere inside an instance (`assertDuplicableInPlace`, naming the instance and what to do), and removes every copy it made if a later one fails (`removeOnFailure`). `duplicate_with_offset` keeps its cleanup and refuses instance layers up front too.                   | `fdb1c9b` |
| 3. P2 repeated `children` reads           | **Confirmed live** (`children !== children`) **and fixed.** The scan walks a stack of cursors, reading each container's `children` once and never touching siblings past the budget. Layer order and `truncated` (some cursor still has unread nodes) are unchanged. Tests: 2,000 fresh-array children with `maxNodes 1` read once; a full scan reads once; a budget ending mid-subtree keeps order; the trace path with `maxNodesPerScreen 1`.                                                        | `6881bc0` |
| P3 synchronous lookup throw               | **Confirmed and fixed.** `memoize` invokes the lookup inside a promise executor, so a synchronous throw becomes that reference's error. Tested for node, variable and collection lookups, synchronous and asynchronous, with an unrelated URL action kept. Not provokable live.                                                                                                                                                                                                                        | `6881bc0` |
| SECTION trace start                       | **Refused explicitly.** The advertised contract is "a screen or a node inside one", and the guide defines a screen as a direct child of a page or section, so a section is outside it. The error says to pass one of its screens or scan the section with `get_prototype_connections`; the tool description and guide now say "not a page or section". Regression test included; verified live.                                                                                                        | `6881bc0` |

**Decision on instance layers.** Before `6668ce3`, `duplicate_nodes` left an instance layer's
copy wherever Figma parented it, which the documentation and the live probe both put on the
current page, possibly a different page and not under the advertised "same parent". That was
never what the tool promised, so the fix refuses the case with a next step instead of restoring
it. The tool description now states the refusal in its first sentence.

**Other observations.** No wiring gaps were reported, and none were introduced: no tool, schema
or capability entry changed, only two duplicate descriptions and the trace description. The
reviewer's remaining notes (stale 322 count in the historical table, FigJam/Slides coverage, plan
regressions such as UI collapse/reconnect not separately evidenced) are evidence limits, not code
defects. The historical table is left as written and the new counts are recorded in the rerun
section. FigJam and Slides remain an open PR gate needing the user's files or an explicit
exception.

**Verification after the fixes (`6881bc0`).** Server 384 pass, 2 skip, 0 fail; plugin 337 pass,
0 fail (13 new); typecheck, both builds, `format:check`, `check-version.mjs` (`0.7.9`) and
`git diff --check` pass. The reviewer's `reproduce.ts` now fails on its first old-behaviour
assertion; an inverted copy that asserts the fixed behaviour with the same doubles exits 0.

## Independent review round 2 - 779300e

**Code verdict: approved. No verified code findings remain. PR readiness: blocked by the
outstanding live checks or a specific explicit user exception. This review grants no exception.**

Fresh independent GPT-6.1-Sol review of `6574482..779300e`, including fixes `100adcb`, `fdb1c9b`
and `6881bc0`, against the full integration from
`55bd5eaf93696049fc1550d1893b38a5d81dfa0b`. Candidate HEAD was
`779300e6c47f25f014d85732c826394743742b41`; the worktree was clean before this appendix.
The original review and implementer responses above were read as evidence to verify, rather than
accepted as the verdict for this round.

### Disposition of every original finding

| Original finding                                         | Independent disposition and current location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2: free connector coordinates                           | **Resolved in code.** `code.ts:471`, used at `:2243` and `:2247`, applies the final parent's complete affine transform to free points. Page and omitted parents preserve canvas coordinates. Attached node IDs and magnets stay unchanged in both mixed directions. Fresh dispatcher checks covered translation, rotation, scale/shear, negative coordinates and page/default placement. This agrees with the [canvas endpoint contract](https://developers.figma.com/docs/plugins/api/ConnectorEndpoint/). **FigJam live verification remains outstanding.**                                                                                                           |
| P2: unreported duplicate after failed reparenting        | **Resolved.** `code.ts:1719` preflights the complete input, and `:1730` protects all created copies with cleanup. `layout-actions.ts:269` checks every ancestor, starting at the parent, so an instance itself remains duplicable while its direct and nested sublayers are refused before cloning. The [instance insertion restriction](https://developers.figma.com/docs/plugins/api/properties/nodes-insertchild/) supports that decision; restoring the previous current-page stray would violate the same-parent contract. Fresh checks confirmed off-page coordinates and cleanup after either a later clone throw or insertion throw for both duplication tools. |
| P2: repeated children getter and eager sibling expansion | **Resolved.** `prototype.ts:254` uses traversal cursors; `:268` reads each expanded container's children once; `:275` distinguishes exhausted cursors from pending work. This removes repeated copies documented by [Figma's children API](https://developers.figma.com/docs/plugins/api/properties/nodes-children/). Fresh checks confirmed layer order, empty containers, exact-budget completion, partial-subtree truncation, and zero pending-child index reads when only the root fits. The shared trace path preserves its scan and screen budgets.                                                                                                               |
| P3: synchronous lookup throw escapes isolation           | **Resolved.** `prototype.ts:207` invokes the loader inside a promise executor. Fresh checks for node, variable and collection loaders covered synchronous non-Error throws and asynchronous Error rejections, preserved an unrelated URL action, and confirmed repeated failed IDs are looked up once per request. The committed regressions also cover synchronous Error throws.                                                                                                                                                                                                                                                                                       |
| Invalid SECTION trace start                              | **Resolved.** `prototype.ts:500` rejects the section with guidance. Scanning a section still works, and tracing a button inside one attributes edges to its screen. Exact scan/screen budget exhaustion and pending targets still behave correctly. Tool description and prototype guide match the refusal. This was invalid-input hardening, not a previously valid-input release blocker.                                                                                                                                                                                                                                                                             |

### Interaction and compatibility review

The fixes use the existing dispatcher gate, parent lookup, cleanup and injected prototype
context. No schema, transport mapper, tool registration or capability entry changed in the fix
range; only the duplicate and trace descriptions changed on the server. The full suites include
the new-tool follower/RPC tests, enriched serializer, capability, SVG safety and diagram
regressions. Inspection found no new wiring or security regression.

Additional independent dispatcher checks allowed ordinary component children and an instance
itself for both duplication tools under all three editable-editor doubles. Instance sublayers,
a missing later ID, and mixed valid/invalid inputs made no copies. Later clone or insertion
failures left no surviving copies. The original node coordinates and successful duplicate
response fields remained intact. These are API-double checks, not FigJam/Slides live evidence.

Prototype checks compared 30 generated trees against an independent expected preorder for
every budget from 1 through the tree size plus 2: **525 tree/budget combinations**, all passing.
Every visited container was read once, unvisited containers were unread, and exact exhaustion
was never marked truncated. Separate checks covered a childless leaf, empty container,
lazy sibling indexing, a 601-node chain, SECTION scans/refusals, trace from a contained button,
URL edges, pending screens and both trace budget limits. No additional code defect was reproduced.

The real upstream merge remains `6636f5e`, with parents `e23100b` and `2c37e6d`; the pinned
upstream is still an ancestor of HEAD. The protected manifest, enriched serializer, bounded
layout tree, transport/loopback/filesystem helpers and release workflow remain unchanged from
the integration base. `6881bc0..779300e` changes documentation only. Historical 322/324 plugin
counts describe earlier candidates; the current 337 count is consistent with the 13 added tests.

### Fresh command evidence

Commands ran from the candidate root unless a package is named. Bun version: `1.4.0`.

| Command                                                                                  | Result                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Server `bun test`                                                                        | 384 pass, 2 Windows skips, 0 fail; 640 assertions, 26 files             |
| Plugin `bun test`                                                                        | 337 pass, 0 fail; 849 assertions, 22 files                              |
| Server `bunx --no-install tsc --noEmit -p tsconfig.json`                                 | Exit 0 using the package's installed compiler                           |
| Plugin `bun run typecheck`                                                               | Exit 0, zero errors                                                     |
| `bun C:/Users/sadhu/AppData/Local/Temp/relay-fix-verify-6881bc0/verify.ts`               | Exit 0; all five original behaviours now satisfy fixed assertions       |
| `bun C:/Users/sadhu/AppData/Local/Temp/relay-review2-779300e/verify.ts`                  | Exit 0; independent boundary/interaction checks described above         |
| `bun run format:check`                                                                   | Exit 0 before this appendix; final docs formatting rechecked afterwards |
| `bun scripts/check-version.mjs`                                                          | Exit 0, `0.7.9`                                                         |
| `git diff --check` and `git diff --check 55bd5eaf93696049fc1550d1893b38a5d81dfa0b..HEAD` | Clean                                                                   |
| `git merge-base --is-ancestor 2c37e6d HEAD`                                              | Exit 0                                                                  |

The two scratch scripts import the real candidate modules/dispatcher with doubles and do not
access Figma. Full-suite logs are in `%TEMP%/relay-review2-server-test.log` and
`%TEMP%/relay-review2-plugin-test.log`.

Read-only hashes of the existing artifacts match the `6881bc0` live-rerun record:

- `server/dist/index.js`: `61b5361b440e3bc4ee33b1a436543e00f3728d9b669f08336e35d3d92687bcc5`.
- Sorted concatenation of the 31 `server/dist/**/*.js` files:
  `4df6bd8ff4fdabdac64a9434903b5f89a60f0b0a43e7a2fa44b101b19c6e69eb`.
- `plugin/dist/code.js`: `696200a90ebe7aba0bf790324713ecac9441a3f7adcd94135543ca02696e7970`.
- `plugin/dist/manifest.json`: `1a061ff39e49a7d135152ad98d93e158ace969210832eed629b96afd28a8b9f3`.

These corroborate the recorded artifact identity. They do not independently replay live results.
Neither package was rebuilt in this review.

### Remaining PR gates and limits

The [live record](2026-10-18-upstream-relay-live-check.md#review-fix-rerun-6881bc0) reports the
15 design-editor rerun cases after the original 28 design checks. No live Figma call was made
in this review. The pending gates remain:

- **FigJam:** all listed creator/label/read/layout/batch and refusal cases, the diagram regression,
  and especially the connector fix with free/mixed ends in moved/nested sections followed by
  parent/endpoint movement.
- **Slides:** the listed layout/batch/text and editor-refusal matrix.
- **Planned regressions:** close the original review's evidence gap for UI reconnect/collapse
  against the live matrix. Do not read the numbered design cases as proof of every plan item.

The parent must obtain these live results on the candidate or the repository-required specific
explicit user exception before PR. The pending request for files or an exception is not approval.
Existing documented Free-plan/API/manifest limits still apply; throwing loaders and post-clone
insertion failure have unit/double coverage only. This round neither expands nor waives those
limits. Any further runtime change needs affected verification and another independent review.

Only this review appendix was changed in the repository. No product edit, commit, merge, push,
PR, Figma mutation, rebuild, subdelegation or change to unrelated local main/dev work was made.

## Independent review round 3 - af7f24e

**Code verdict: approved. No verified actionable code findings. PR readiness remains separate:
the required paid prototype-action checks and unloaded-page-root evidence below are not closed
by this review, and no user exception is recorded.**

Fresh independent GPT-6.1-Sol review at
`af7f24ebc05faa656d2a00385cbc4b4fe1999b70`, starting from a clean
`feat/upstream-relay-oct18` worktree. Primary diff: `66fd2b7..af7f24e`, checked against
the earlier integration from `55bd5ea`, its two prior reviews, the audit design, implementation
plan, repository rules and complete live-check record. Original reports and responses above
are retained unchanged. This round did not delegate work.

### New fix dispositions

- **`367920e`, shape default: approved** (`plugin/src/main/code.ts:2156`). The dispatcher
  explicitly assigns SQUARE when `shapeType` is omitted, before any label/style/placement work.
  An explicit shape still wins. This corrects the advertised default despite Figma's toolbar
  state. The committed fake starts at ELLIPSE, making the default test meaningful. Independent
  dispatcher checks covered omitted, SQUARE, DIAMOND and ELLIPSE values and cleanup after a
  font failure. The live record verifies SQUARE with and without a parent, and explicit DIAMOND.
- **`750ee6e`, mixed connector parent: approved** (`code.ts:484`, `:2253`). Only a free end
  beside a node end and inside an explicit non-page parent receives
  `{ endpointNodeId: parent.id, position: parentLocalPoint }`. It is not transformed twice.
  This is the supported node-relative endpoint variant in the
  [Figma endpoint contract](https://developers.figma.com/docs/plugins/api/ConnectorEndpoint/).
  Both-free endpoints keep `100adcb`'s full canvas transform; explicit PAGE and omitted parents
  retain canvas points. Node IDs, chosen magnets, ELBOWED initialization, labels, stroke and
  self-loop sides survive. No endpoint or schema/transport field was removed.
- **Parent enforcement and cleanup: approved** (`code.ts:2279`). An explicit requested parent
  must match Figma's final parent. A mismatch throws within `removeOnFailure`, removing the
  connector from wherever Figma placed it. Two attached nodes below the requested container
  now receive a refusal rather than a successful result in a different container. This is an
  intentional tightening of the parent contract, documented in the tool and guide, with a
  usable next step. Without `parentId`, attached connectors retain Figma's existing closest
  container behavior. Missing/off-page endpoints still fail before creation.
- **`3b91bed`, mismatch advice: approved** (`code.ts:2282`). The error names both actual and
  requested containers, offers the actual `parentId`, and describes moving the nodes so the
  requested parent is their closest shared container. It works when the nodes are already
  descendants of the requested parent. Both the test and raw live refusal confirm that case.
- **`af7f24e`, evidence/docs: consistent.** The last commit changes documentation only.
  The guides now acknowledge page/parent anchor IDs for floating ends instead of promising
  `null`. The serializer itself is unchanged. Creator results still omit a node ID for a free
  input end, while a subsequent `get_node` truthfully reports Figma's parent anchor.

The original duplicate preflight/cleanup, lazy prototype traversal, synchronous lookup isolation
and SECTION trace refusal remain resolved. No interaction in the latest diff changes their
code. The real upstream merge is still `6636f5e`, with `e23100b` and pinned upstream `2c37e6d`
as parents; the upstream ancestor check passes. The stable manifest, enriched serializer,
layout-tree implementation, loopback/transport/filesystem helpers and release workflow checked
against `55bd5ea` remain unchanged.

### Independent checks and evidence

Fresh commands, without emitting or rebuilding either package:

- Server `bun test`: **384 pass, 2 Windows skips, 0 fail**, 640 assertions, 26 files.
- Plugin `bun test`: **341 pass, 0 fail**, 885 assertions, 22 files. A second captured run
  confirms the complete summary in `%TEMP%/relay-review3-plugin-test.log`.
- Server `bunx --no-install tsc --noEmit -p tsconfig.json`: exit 0.
- Plugin `bun run typecheck`: exit 0, zero errors.
- Root `bun run format:check`, `bun scripts/check-version.mjs` (`0.7.9`),
  `git diff --check 55bd5ea..HEAD` and `git merge-base --is-ancestor 2c37e6d HEAD`: pass.
- `bun C:/Users/sadhu/AppData/Local/Temp/relay-review3-af7f24e.ts`: exit 0. This independent
  API-double script imports the real dispatcher, input/RPC schemas and FigJam serializer;
  it does not contact Figma. It made **405 dispatcher calls**, including **360 mixed-end
  cases** (both directions; all six default/explicit anchor choices; SECTION/FRAME/GROUP;
  direct/deeper endpoint nodes; nested translation, both right-angle rotations and affine
  scale/shear), plus **15 both-free transform cases**. It checks endpoint representations,
  parent identity, absence of append-after-endpoint writes, labels and stroke weight.
  It also checks explicit PAGE/default parents, no-parent attached behavior, self-loops,
  deeper/outside-parent refusals, five injected connector failures (append, either endpoint,
  stroke, font), missing/off-page IDs before creation, editor refusals, shape defaults and
  explicit values, shape-font cleanup, invalid schema combinations and RPC ID preservation.
  Serializer output includes the mixed free end's parent anchor. No created fake node survived.

The committed test double now models per-assignment closest-container reparenting and the
observed append-after-endpoint geometry drift. It no longer assumes that appending first is
sufficient. Its geometry model is deliberately narrower than Figma's layout engine; the real
translated/nested/rotated parent and movement assertions come from the recorded live run,
not from treating doubles as live evidence.

Read-only artifact hashes independently match the `3b91bed` live run:

- `server/dist/index.js`: `61b5361b440e3bc4ee33b1a436543e00f3728d9b669f08336e35d3d92687bcc5`.
- Sorted concatenation of 31 server JavaScript files:
  `21afcc90047a7e9aa5dcf5b347012ebc08f797b4f3c816096c858a9a73095719`.
- `plugin/dist/code.js`: `ec9bdaf3d7645eabe1e27422246681bc639650e87e12613956afb2c6892aac3a`.
- `plugin/dist/manifest.json`: `1a061ff39e49a7d135152ad98d93e158ace969210832eed629b96afd28a8b9f3`.
- `plugin/dist/index.html`: `5f32c50a019670112571bcf3449ba5e29caae671a9f5e23060ac8fbbacf8bad4`.

The latest raw `%TEMP%/relay-mixfix/final-01.log`, `final-02.log`, `final-05b.log`,
`final-09.log`, `final-10.log`, `readf.log` and `movef.log` corroborate the recorded results:
both mixed orientations, rotated placement, actionable parent refusals, no surviving refused
connectors, real parent anchor IDs, parent movement and attached-node movement. These are
inspected prior-run artifacts; no live assertion was replayed by this reviewer. The old leader
does not need a restart for the new tool-description text: routing/schema code did not change,
and the recorded calls used followers running the updated handler build.

### Remaining PR gates versus unit-only limits

The earlier **FigJam, Slides and UI collapse/relaunch/reconnect gaps are closed** by the
`66fd2b7` evidence and the affected `3b91bed` FigJam rerun. The final-parent refusal was itself
tested live, including cleanup. The older matrices remain applicable to unchanged paths;
the final source changes are limited to the FigJam shape/connector implementations and the
connector description. The untested Disconnected badge is not an additional requirement of
the plan's collapse/reconnect-after-relaunch regression.

Two concrete items remain before the parent can claim the full planned live matrix:

- **Conditional / Set Variable / Set Variable Mode actions.** These are supported inputs and
  explicitly planned live cases, unavailable on the current Free plan. Unit tests pass, but
  [the repository rule](../../.claude/CLAUDE.md#workflow) says: "If Figma, a required editor,
  plan or permission is unavailable, stop before opening the PR or merging" and requires a
  specific explicit user exception. This review cannot supply one. Obtain the paid-path live
  evidence or the user's exception for those exact cases.
- **A genuinely unloaded non-current page root.** The live record says its scratch pages were
  already loaded, while Task 8 explicitly asks for an unloaded second-page root/target.
  Unloaded-page scans are valid supported inputs, and the tests at `prototype.test.ts:470`
  and `:478` pass. Cross-page navigation being invalid does not make a scan rooted on another
  page invalid. Close this distinct live evidence gap on an unloaded page where available;
  if that state cannot be obtained in the available files, document that blocker and include
  it in a specific user exception. An already-loaded off-page scan is not proof of this case.

The following do **not** independently require new impossible-fixture live work or a waiver:

- **Dev Mode:** the spec, plan and plugin rules explicitly choose unit coverage because it is
  excluded from the shipped manifest and the seat is unavailable. Enabling it is out of scope.
- **Cross-page navigation and deleted destinations:** Figma rejects the former and removes
  the reaction for the latter. Their defensive reader behavior is covered by tests; there is
  no valid remaining live action fixture to exercise in the documented API setup. The plan
  already qualifies a missing-destination check with "where constructible".
- **Synchronous/rejected reference loaders and insertion failure after a successful clone:**
  these require injected faults once the known instance restriction is preflighted. Relevant
  successful paths and actual instance refusals were checked live; failure isolation and
  cleanup are covered by tests. No evidence supports demanding a valid-document live
  reproduction of those injected faults.

The parent owns closure of the two evidence gates, any requested exception, and subsequent PR
work. This review approves code; it does not authorize bypassing the repository's live gate.
Only this appendix was added in the worktree. No product edit, build, relay stop/restart,
Figma mutation, commit, push, PR, merge or subdelegation was performed.
