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
