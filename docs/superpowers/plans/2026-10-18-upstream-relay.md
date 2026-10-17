# Upstream Relay Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user selected one Claude Opus 5.5 implementer; the parent arranges the subsequent independent GPT-6.1-Sol review. Do not subdelegate or ask for the execution method again.

**Goal:** Integrate useful upstream changes through `2c37e6d` without regressing the relay's
existing tools, editor support, private distribution or safety boundaries.

**Architecture:** A real upstream merge retains ancestry. Resolve against the existing relay
schemas/dispatcher and extract injectable prototype, SVG, text-target, property and layout logic
where unit tests need it. Every new tool uses the existing node router and follower validation.

**Tech Stack:** TypeScript, Zod 3, Bun tests, Node ESM on the server, Vite and Figma Plugin API.

**Spec:** `docs/superpowers/specs/2026-10-18-upstream-relay-audit-design.md` (U1-U7, D1-D4).

## Global Constraints

- Worktree: `C:/Users/sadhu/.t3/worktrees/figma-design-relay/feat-upstream-relay-oct18`.
- Branch: `feat/upstream-relay-oct18`; audited base `55bd5ea`, upstream pin `2c37e6d`.
- Bun only; LF only. No npm publishing. Keep `figma-design-relay-server`, private packages,
  relay CLI/env names and `127.0.0.1` binding. Keep existing Origin/content-type RPC guards.
- Preserve stable manifest `[figma, figjam, slides]`, permissions and `dynamic-page`; dev manifest
  is generated in `plugin/dist`, with its port in the displayed name. Never edit stable for dev.
- New plugin modules take dependencies as parameters and do not reference global `figma`.
- Server local imports end in `.js`; plugin imports are extensionless.
- Node IDs travel on transport `nodeIds`. New tools have schemas, `rpcToArgs`, handler,
  dispatcher, capability entries, docs and follower coverage in the same final candidate.
- Preserve canonical `text`, existing creator `type` results, SQUARE default and paired
  dimensions on existing FigJam creators. SVG dimensions may be given individually.
- Prototype limits: maxNodes 5000/50000; maxScreens 25/500; maxNodesPerScreen 5000/50000
  (default/maximum). SVG cap: 2097152 UTF-8 bytes.
- Patch sync release: both package versions `0.7.9` plus `CHANGELOG.md`, unless another release
  lands before execution, in which case use the next available patch of that release line.
- No dev/main merge, PR, tag, release or client-config edit by the implementer. Parent owns
  independent review, later fixes/reviews and final PR/integration.
- Routine design choices and execution are authorized. A missing required live editor/path is
  a specific pre-PR blocker, not permission to waive the repository's live gate.

## Review Focus

1. A follower strips or reintroduces node IDs in params, causing scans/layout/batches to target
   another node: pin simulated round trips in Tasks 1-5 and real follower calls in Task 8.
2. SVG bytes reach the plugin after a workspace link escape or oversized UTF-8 input: pin
   containment, bounded reads and wire-size tests in Task 3.
3. Cross-page prototype cycles, missing IDs and rejected async lookups must produce finite,
   informative output rather than losing all connections: pin Task 2 fixtures.
4. Existing FigJam `text`, dimension pairs, labels and toolbar-selected connector settings must
   remain compatible: pin Task 7 and live checks in Task 8.
5. A batch/layout/creator failure must not silently leave avoidable partial output: preflight
   IDs/properties/coordinates and test cleanup in Tasks 3-7; document Figma setter limits.

## Execution and commit boundaries

The parent must make these research docs available to the implementer. If the parent delegates
with `isolation: worktree`, commit the documentation first: uncommitted files are not copied to
the child's worktree. Otherwise pass the absolute paths and reuse this authorized worktree.

Task 1 writes and runs the initial red regression contracts **before** upstream product code
arrives, then commits those local tests so the merge can start from a clean tree. Task 2 starts
`git merge --no-commit --no-ff 2c37e6d`. Keep that local merge pending through Tasks 2-7;
stage each completed slice rather than accidentally closing the merge with a per-task commit.
Task 8 closes the merge only after the integrated candidate is green, then records live evidence
in a docs-only commit. Do not push the intermediate red test commit by itself.

### Task 1: Green baseline and red integration contracts [U1-U7]

**Files:**

- Modify/test: `server/src/schema.test.ts`, `server/src/file-tools.test.ts`,
  `plugin/src/main/dispatcher.test.ts`, `plugin/src/main/capabilities.test.ts`.
- Create/test: `server/src/upstream-tools.test.ts`.

**Interfaces:**

- Consumes `registerTools(server, node, port)` and `validateRpc(tool, nodeIds?, params?)`.
- Produces reusable captured-handler tests: fake `server.tool(name, ...args)` records the final
  handler; fake `sendWithParams` records `{ type, nodeIds, params, fileKey }` and runs
  `validateRpc` to simulate the follower before returning a stub BridgeResponse.
- Dispatcher fixture extends the existing `api.ui.onmessage({ type: 'server-request', payload })`
  harness, changing stub editor/node lookups per case and restoring them after each test. Keep
  one import of `code.ts`; a second test file importing it would hit the module cache.

- [ ] **Step 1: Establish prerequisites and the unchanged baseline.**

Read the five repository skills named in the spec. Confirm branch/HEAD/status, reuse this
worktree and claim its slot with `bun scripts/dev-slot.mjs upstream-relay-oct18` if none exists.
Install existing dependencies with `bun install --frozen-lockfile` at root, server and plugin,
using separate working-directory calls. Do not keep unrelated lockfile rewrites.

Run: `bun run check` from root. Expected: version 0.7.8, both suites/builds/formatting pass,
plugin type-check has zero errors. Record the actual counts; do not copy the research task's
incomplete server count. Stop to diagnose any failure that persists after dependencies exist.

- [ ] **Step 2: Write initial failing contracts for every new behavior before merging.**

Add tests with these names and concrete assertions (the existing tool-map tests can capture
handlers without changing production code):

```ts
// schema.test.ts
expect(validateRpc("get_node", ["1:2"], { includePrototype: true }).params).toEqual({
  includePrototype: true,
});
expect(validateRpc("set_node_properties", ["1:2", "1:3"], { visible: false }).params).toEqual({
  visible: false,
});
expect(
  validateRpc("create_connector", undefined, {
    startX: 0,
    startY: 0,
    endX: 10,
    endY: 20,
    text: "go",
  }).error
).toBeNull();
expect(
  validateRpc("create_shape_with_text", undefined, {
    text: "DB",
    name: "Database",
    fillHex: "#123456",
  }).params
).toMatchObject({ text: "DB", name: "Database", fillHex: "#123456" });
```

In `upstream-tools.test.ts`, assert each of the ten new names is registered exactly once, and
that `get_node.includePrototype` and a two-ID property batch reach the sender with fileKey `k`.
In the dispatcher fixture, assert `set_text_content` changes a STICKY's `.text.characters`,
FigJam `get_styles` returns a working paint category despite an unavailable text-style API,
and a rejected FigJam variable API returns empty collections **with a note**.

- [ ] **Step 3: Run the new contracts and verify behavioral failures.**

Run in server: `bun test src/schema.test.ts src/upstream-tools.test.ts`.
Run in plugin: `bun test src/main/dispatcher.test.ts`.
Expected: missing registrations, stripped fields, batch target loss, sticky target refusal and
read fallback failures. Module-resolution failures are not valid red behavior evidence here.

- [ ] **Step 4: Commit only the new regression contracts locally.**

Use explicit paths with `git add`, then `git commit -m 'test(upstream): pin missing relay contracts'`.
Keep baseline dependency changes out unless deliberate; keep these audit/plan documents if the
parent has already committed them. Record the new premerge test commit for comparison.

### Task 2: Real upstream merge and prototype inspection [U1]

**Files:**

- Modify: conflicting files listed in the spec, `server/src/schema.ts`, both lockfiles,
  `plugin/src/main/capabilities.ts`, `plugin/src/main/capabilities.regression.test.ts`.
- Adapt upstream addition: `plugin/src/main/prototype.ts`.
- Create/test: `plugin/src/main/prototype.test.ts`.
- Test: `server/src/schema.test.ts`, `server/src/upstream-tools.test.ts`,
  `plugin/src/main/dispatcher.test.ts`, `plugin/src/main/capabilities.test.ts`.

**Interfaces:**

- Produce `PrototypeContext` in `prototype.ts`: `getNodeByIdAsync(id): Promise<BaseNode|null>`,
  `getVariableByIdAsync(id): Promise<Variable|null>`,
  `getVariableCollectionByIdAsync(id): Promise<VariableCollection|null>`, `fileName: string`,
  `fileKey?: string`.
- Export upstream `ScanOptions`, `ScanResult`, `TraceOptions`, `FlowTrace`;
  `scanPrototype(root: PageNode|SceneNode, options: ScanOptions|undefined, context: PrototypeContext): Promise<ScanResult>`;
  export `NodeRef = Pick<BaseNode, 'id'|'name'|'type'>` and `PrototypeFileInfo` with
  schemaVersion 1, fileKey string|null, fileName string, page NodeRef|null and flowStartingPoints
  readonly `{ nodeId: string; name: string }[]`;
  `getPrototypeConnections(root: PageNode|SceneNode, options: ScanOptions|undefined, context: PrototypeContext): Promise<ScanResult & PrototypeFileInfo>`;
  `tracePrototypeFlow(start: SceneNode, options: TraceOptions|undefined, context: PrototypeContext)`
  returns `Promise<FlowTrace & PrototypeFileInfo>`. Keep output keys and schemaVersion 1.

- [ ] **Step 1: Start the pinned local integration merge without committing.**

Run: `git merge --no-commit --no-ff 2c37e6d`.
Expected: conflicts forecast by the spec; HEAD remains the red-test commit, MERGE_HEAD is the
upstream tip. Resolve all files intentionally using the spec's conflict rules. Keep relay
release workflow, manifest and enriched async serializer. Deduplicate declarations and
registrations even where Git reports a clean merge. Keep versions at 0.7.8 until Task 8.
Retain upstream's exhaustive shape guard; upgrade plugin typings to `^1.140.0` and place the
server's matching type-only package in devDependencies. Install with Bun and inspect lock diffs.

- [ ] **Step 2: Add detailed failing prototype tests before adapting upstream logic.**

Fixtures: screen A/button, screen B/instance sublayer, screen C inside a SECTION, and a second
page whose children throw until `loadAsync`. Assert:

- A -> B -> A expands screens `[A, B]` with depths `[0, 1]` and one revisit, never loops.
- Nested CONDITIONAL/else actions retain exact `actionPath` and conditions, including `null`;
  URL/BACK/CLOSE/scroll/change-to/media/variable actions are edges but not extra screens.
- Overlay/SWAP destination settings, variable name/type, collection/mode names and page flow
  starts survive. Deprecated `reaction.action` works if `actions` is absent.
- One destination referenced twice loads once per request; absent/throwing destination lookup
  is unresolved and does not discard other edges. Throwing variable/collection lookup yields
  null metadata while retaining its action IDs.
- maxNodes 1 scans exactly 1 and flags remaining work; maxScreens 1 returns pending targets;
  exact exhaustion is not falsely truncated. IncludeEmpty lists supported empty reactions.
- Roots/targets on unloaded pages load before child access, including cross-page trace.

Run in plugin: `bun test src/main/prototype.test.ts`.
Expected: FAIL against the upstream global API/context/page/error behavior, before its adaptation.

- [ ] **Step 3: Implement D1 with injected context and complete all three entry points.**

Keep bounded DFS scans, BFS screen expansion, section screen boundaries, unresolved tracking
and request-scoped memoization. Await `serializeNode` before adding `prototype` in `get_node`;
retain page loading and ordinary get-node output. Send optional scan root on transport IDs.
Add schema bounds, mapper entries, descriptions and the conditional `get_node_prototype` gate.
Allow prototype reads in figma/dev, refuse FigJam/Slides. Amend the capability regression's
blanket dev prohibition to permit only the three explicit prototype read keys; all writes
remain prohibited. Add SECTION auto-layout refusal without weakening the existing editor gate.

- [ ] **Step 4: Verify and stage the prototype slice.**

Run in plugin: `bun test src/main/prototype.test.ts src/main/dispatcher.test.ts src/main/capabilities.test.ts src/main/capabilities.regression.test.ts`.
Run in server: `bun test src/schema.test.ts src/upstream-tools.test.ts`.
Expected: prototype-specific assertions pass; assert bounds 0/fraction/max+1 fail, DOCUMENT scan
and PAGE trace fail, and instance-child IDs survive the simulated follower. Unrelated new
feature red tests may remain until their task. Stage only intended files; do not close the merge.

### Task 3: Safe editable SVG import [U2]

**Files:**

- Create: `server/src/svg.ts`, `server/src/svg.test.ts`, `plugin/src/main/svg.ts`,
  `plugin/src/main/svg.test.ts`.
- Modify: `server/src/schema.ts`, `server/src/tools.ts`, `plugin/src/main/code.ts`,
  `plugin/src/main/capabilities.ts`, `plugin/src/main/capabilities.regression.test.ts`.
- Test: `server/src/schema.test.ts`, `server/src/file-tools.test.ts`,
  `server/src/upstream-tools.test.ts`, `plugin/src/main/dispatcher.test.ts`.

**Interfaces:**

- Export `MAX_SVG_BYTES = 2097152` from `schema.ts` and `createSvgInput`.
- `server/src/svg.ts`: `loadSvgSource(source: string, workspaceRoot: string): Promise<string>`.
- `plugin/src/main/svg.ts`: export `SvgPlacement` (optional name, parentId, x/y/width/height),
  `SvgResult` (D2 result keys), and
  `createSvg(svgText: string, placement: SvgPlacement, api: { createNodeFromSvg(svg: string): FrameNode; getParentNodeById(id: string): Promise<BaseNode & ChildrenMixin> }): Promise<SvgResult>`.
- Wire schema is createSvgInput minus source/fileKey plus bounded nonempty `svgText`.

- [ ] **Step 1: Write loader, wire and cleanup tests with concrete boundaries.**

Assert raw SVG, BOM/XML/comments/DOCTYPE, workspace paths and `..icons/a.svg` succeed.
Assert empty/HTML/malformed-prolog input, missing path, directory, `../outside.svg`, external
absolute path and a Windows directory junction escape fail with no send. No fetch for HTTPS or
data URI input. Exactly 2097152 bytes succeeds and 2097153 fails, including multibyte text;
repeat the cap check through `validateRpc('create_svg', undefined, { svgText })`. Test the file
reader cannot consume beyond cap+1 bytes if a file grows (inject a small reader seam if needed),
and post-open identity/containment mismatch fails before reading contents. Use the repository's
platform skips only for privileged leaf symlinks; junction coverage must run on Windows.

Plugin helper assertions: invalid parent causes zero creates; resizing/append/position failure
removes the new SVG exactly once; x/y are relative to final parent; width-only and height-only
preserve the other dimension; successful result includes nodeType and childCount.

- [ ] **Step 2: Run tests to see the missing helper/safety behavior fail.**

Run in server: `bun test src/svg.test.ts src/file-tools.test.ts src/schema.test.ts`.
Run in plugin: `bun test src/main/svg.test.ts`.
Expected: missing extracted exports or assertions fail against the unadapted upstream loader.

- [ ] **Step 3: Implement D2 and connect the tool.**

Move upstream's loader into its module, use workspace component-boundary helpers, retain
descriptor identity checks and bounded byte reads. Source resolution occurs before transport;
only markup crosses the follower. Wire the injected plugin helper, design-only capability and
actionable errors. Do not add URL fetch, XML entities processing or an SVG sanitization claim.

- [ ] **Step 4: Verify and stage SVG.**

Repeat Step 2 plus `bun test src/upstream-tools.test.ts` in server and capability tests in plugin.
Expected: safety/helper tests pass; one create_svg registration; fileKey `k` and svgText survive
the simulated follower; source is absent from wire params. Stage, keeping the merge pending.

### Task 4: Backward-compatible batch properties [U3]

**Files:**

- Create: `plugin/src/main/node-properties.ts`, `plugin/src/main/node-properties.test.ts`.
- Modify: `server/src/schema.ts`, `server/src/tools.ts`, `plugin/src/main/code.ts`.
- Test: `server/src/schema.test.ts`, `server/src/upstream-tools.test.ts`,
  `plugin/src/main/dispatcher.test.ts`.

**Interfaces:**

- Export `setNodePropertiesShape` for MCP advertisement and refined `setNodePropertiesInput`
  for validation. Keep toolInputSchemas.set_node_properties using the refined schema.
- Export `NodePropertyPatch` with the existing name/x/y/width/height/rotation/opacity/visible/
  cornerRadius options; `preflightNodeProperties(node: SceneNode, patch: NodePropertyPatch): void`;
  `applyNodeProperties(node: SceneNode, patch: NodePropertyPatch): Record<string, unknown>`.
- Dispatcher deduplicates/resolves all transport IDs, preflights all, then applies; singleton
  result unchanged, multiple results `{ updatedCount, results }`.

- [ ] **Step 1: Write failing batch/preflight tests.**

Assert old `{ nodeId: '1:2', visible: false }` is accepted; a two-node batch updates both;
nodeIds wins if both ID forms are supplied; repeated IDs are applied once in input order.
Absent/empty IDs and empty patches fail. Missing second ID and unsupported readonly
SHAPE_WITH_TEXT cornerRadius leave the first node unchanged. Include a singleton result
snapshot and a two-result updatedCount 2 assertion. A follower's sanitized params must be
exactly `{ visible: false }`, with neither ID field nor fileKey reintroduced.

- [ ] **Step 2: Run tests and confirm failure before preflight implementation.**

Run in plugin: `bun test src/main/node-properties.test.ts src/main/dispatcher.test.ts`.
Run in server: `bun test src/schema.test.ts src/upstream-tools.test.ts`.
Expected: preflight/deduplication/readonly assertions fail against upstream's sequential setters.

- [ ] **Step 3: Implement D3 without dropping existing property semantics.**

Extract the relay's existing property application, add whole-batch validation and preserve
partial width/height support. Update mapper/handler and strip both nodeId and nodeIds only
after schema validation. Check other node-list tools still receive transport IDs. State the
nontransactional setter limitation in the tool description and guide.

- [ ] **Step 4: Re-run Step 2; stage only after all batch assertions pass.**

Also run existing selection/reparent/delete schema tests to catch ID stripping regressions.

### Task 5: Bounded layout helpers [U4]

**Files:**

- Create: `plugin/src/main/layout-actions.ts`, `plugin/src/main/layout-actions.test.ts`.
- Modify: `server/src/schema.ts`, `server/src/tools.ts`, `plugin/src/main/code.ts`,
  `plugin/src/main/capabilities.ts`.
- Test: `server/src/schema.test.ts`, `server/src/upstream-tools.test.ts`,
  `plugin/src/main/capabilities.test.ts`, `plugin/src/main/dispatcher.test.ts`.

**Interfaces:**

- Keep upstream schema exports `fitToContentInput`, `distributeInput`, `alignToGridInput`,
  `placeBelowInput`, `placeRightOfInput`, `duplicateWithOffsetInput`.
- Export `LayoutRequestType` as the seven U4 request names; `LayoutParams` with optional padding,
  gridSize, relativeToId, gap, align (`start`|`center`), offsetX, offsetY;
  `executeLayoutAction(type: LayoutRequestType, nodeIds: readonly string[], params: LayoutParams, api: { getSceneNodeById(id: string): Promise<SceneNode> }): Promise<Record<string, unknown>>`.
- Return upstream result keys except distribution's corrected interior-only movedCount/results
  specified in D3. `fit_to_content` uses `resizeWithoutConstraints` for sections.

- [ ] **Step 1: Write geometry, validation and cleanup tests before extracting code.**

Use three siblings at x `[0, 20, 100]`, widths `[10, 20, 30]`: distribution gap is 35,
middle x becomes 45, endpoints remain exactly 0 and 100, movedCount is 1. Repeat vertically,
with negative gaps, zero sizes and fractional endpoints. Grid 10 maps x=-14 to -10 and y=16
to 20. Reference `{x:10,y:20,width:100,height:40}` and target `{width:20,height:10}` with
gap 5/center produces below `{x:50,y:65}` or right `{x:115,y:35}`.

Section children at `(-10,5,20,10)` and `(30,25,10,5)`, padding 5, produce section `60x35`
and child positions `(5,5)` and `(45,25)`, keeping section origin fixed. Empty/padding 0 is
`0.01x0.01`. Duplicate offset `(5,-3)` preserves each source and parent, returns source IDs,
and removes all clones if a later clone/setter fails. Missing nodes, duplicate layout IDs,
self-reference, rotated bounds, mixed parents and auto-layout parents fail before writes.

Schema assertions: distribute needs 3 IDs; grid >0; padding/gap >=0; finite numeric values;
valid instance-child IDs; each handler's fileKey and IDs survive simulated follower validation.

- [ ] **Step 2: Run the tests and verify red extraction/restriction behavior.**

Run in plugin: `bun test src/main/layout-actions.test.ts`.
Run in server: `bun test src/schema.test.ts src/upstream-tools.test.ts`.
Expected: missing helper or upstream coordinate/preflight/endpoint behavior fails.

- [ ] **Step 3: Implement D3 and all seven tool routes.**

Resolve and preflight all nodes before mutation. Keep helper math local to the shared parent,
enforce documented bounds and return actionable next steps for unsupported arrangements.
Register/gate seven writes; sections refuse Slides, all seven refuse dev. Generic writes
allow existing free-positioned Slides nodes; do not claim slide structure creation support.

- [ ] **Step 4: Verify and stage layout.**

Repeat Step 2 and plugin capability/dispatcher tests. Expected: exact geometry above, ten new
tools total registered once, all request-name capability entries present. Stage the slice.

### Task 6: FigJam text and read resilience [U5, U7]

**Files:**

- Create: `plugin/src/main/text-target.ts`, `plugin/src/main/text-target.test.ts`.
- Modify: `plugin/src/main/code.ts`, `plugin/src/main/capabilities.ts`,
  `plugin/src/main/capabilities.regression.test.ts`, `server/src/tools.ts`.
- Test: `plugin/src/main/dispatcher.test.ts`, `plugin/src/main/capabilities.test.ts`.

**Interfaces:**

- Export `TextTarget` as upstream's discriminated `{ kind: 'text', node: TextNode, text: TextNode }`
  or `{ kind: 'sublayer', node: StickyNode|ShapeWithTextNode, text: TextSublayerNode }`.
- Export `getTextTargetById(id: string, toolName: string, getNodeByIdAsync: (id: string) => Promise<BaseNode|null>): Promise<TextTarget>`.
- Existing code.ts font loader and applyTextFill accept `TextNode | TextSublayerNode`.
- Read result additions are `notes?: string[]` for styles and `note?: string` for variables;
  existing paints/text/effects/grids and collections keys remain unchanged.

- [ ] **Step 1: Extend red text/read regressions.**

Assert TEXT returns its original outer ID; STICKY/SHAPE_WITH_TEXT edit `.text` and report the
outer ID/name; RECTANGLE is refused. Mixed fonts load before character writes; font load
failure leaves text unchanged. An unsupported alignment plus valid fontSize on a sublayer
fails **before** fontSize or other properties change. Ordinary Slides TEXT content still edits;
set_text_properties remains refused there and all text writes remain refused in dev.

FigJam style fixture: paint API resolves one paint, text API throws, effects resolve empty and
grid API would throw if accessed. Assert paint survives, text/effects/grids are arrays, grid
was not called, and notes names text. Variable failure returns empty collections with note;
successful variables retain serialized values. Same errors in figma must remain errors.

- [ ] **Step 2: Run the targeted tests and verify meaningful red failures.**

Run in plugin: `bun test src/main/text-target.test.ts src/main/dispatcher.test.ts src/main/capabilities.test.ts src/main/capabilities.regression.test.ts`.
Expected: unsupported-subfield preflight or read-note assertions fail before the adaptation.

- [ ] **Step 3: Implement D4 text and read contracts.**

Use injected text resolution, preflight TEXT-only properties, retain canonical text aliases
and existing response shapes. Broaden only set_text_properties to figma/FigJam. In the existing
read cases, catch per-category failures only for FigJam and include useful notes; retain the
design path's failure behavior. Avoid new global-dependent modules.

- [ ] **Step 4: Repeat Step 2 and stage when all text/read assertions pass.**

Also run plugin serializer/figjam-serializer tests to prove default serialized `text` output
and async reference enrichment were not replaced by upstream's simpler serializer.

### Task 7: Additive FigJam creator capabilities [U6]

**Files:**

- Modify: `server/src/schema.ts`, `server/src/tools.ts`, `plugin/src/main/code.ts`,
  `plugin/src/main/diagram.ts`, `plugin/src/main/diagram.test.ts`.
- Test: `server/src/schema.test.ts`, `server/src/upstream-tools.test.ts`,
  `plugin/src/main/dispatcher.test.ts`.

**Interfaces:**

- Keep existing advertised `createShapeWithTextShape`/`createSectionShape` and their refined
  Input schemas; extend `createStickyInput` and connector shape/refinement without removing text.
  If sticky label normalization makes an effects schema, export a raw `createStickyShape` and
  register its `.shape`, then parse with createStickyInput as existing transformed tools do.
- Export `ConnectorAnchor = 'top'|'bottom'|'left'|'right'|'auto'` and extend
  `attachConnector(connector, startId: string, endId: string, anchors?: { start?: ConnectorAnchor; end?: ConnectorAnchor }): void`;
  old three-argument calls preserve self-loop CENTER/ELBOWED behavior. Coordinate endpoints
  are handled in the creator after appending to the validated final parent.
- No existing creator result key is removed; `describeCreated` remains the shared base shape.

- [ ] **Step 1: Add compatibility, endpoint and failure tests.**

Assert text wins over characters; characters-only and omitted labels normalize to text and
empty text; old `{ text: 'DB' }` still creates SQUARE; width-only shape/section still fails.
Test sticky parent/name/isWideWidth; styled shape font/color/rotation; section parent/fill/hidden.
For each endpoint test ID, full coordinates, missing coordinate, both representations and anchor
without ID. Verify new params survive a simulated follower and unknown keys are stripped.

Dispatcher assertions: invalid parent/endpoint creates zero nodes; parent/resize/font/attach
failure removes the created node. Force toolbar line type STRAIGHT and empty connector font,
then assert labelled attached connector succeeds via ELBOWED plus `labelFont`; old self-loop
uses CENTER. Test explicit top/bottom magnets, floating-to-node mixed endpoints, local section
coordinates after append and preservation of text/type/startNodeId/endNodeId in old results.

- [ ] **Step 2: Run tests before implementing compatibility fixes.**

Run in server: `bun test src/schema.test.ts src/upstream-tools.test.ts`.
Run in plugin: `bun test src/main/dispatcher.test.ts src/main/diagram.test.ts`.
Expected: upstream spelling/defaults, pair sizing or connector-state assertions fail.

- [ ] **Step 3: Implement additive creator normalization and cleanup.**

Apply only missing parameters. Preserve existing omitted-size behavior, paired dimensions,
text/type fields and creator gates. Resolve/load parent and endpoint nodes before creation;
use `removeOnFailure`, `attachConnector` and `labelFont` rather than upstream's raw connector
assignment. Check existing diagram rendering still uses its old helper contract.

- [ ] **Step 4: Re-run Step 2 and all plugin tests; stage the completed integration.**

Expected: every old and new creator assertion passes and no serializer/diagram regression.

### Task 8: Documentation, patch version, full checks and live handoff [U1-U7]

**Files:**

- Modify: `README.md`, `CHANGELOG.md`, `server/package.json`, `plugin/package.json`,
  `.claude/CLAUDE.md`, applicable `.claude/rules/*.md`, `docs/README.md`,
  `docs/guides/figjam.md`, `docs/guides/slides.md`, `docs/superpowers/README.md`.
- Create: `docs/guides/prototypes.md`, `docs/guides/svg.md`, `docs/guides/layout.md`,
  `docs/reference/2026-10-18-upstream-relay-live-check.md`.
- Update research documents only when implementation or evidence changes a stated decision.

**Interfaces:**

- Deliver a committed feature branch with upstream ancestor `2c37e6d`, coherent patch version,
  exact tool inventory and durable automated/live evidence for independent parent review.
- Live record names candidate commit and build SHA-256 hashes for server/dist/index.js,
  plugin/dist/code.js and plugin/dist/manifest.json, plus slot name/port, files/editors, commands,
  returned IDs and assertions. Keep user document content out of the report beyond needed IDs.

- [ ] **Step 1: Document contracts and finish the patch release metadata.**

Add the ten README tool rows and update existing rows/descriptions. Explain prototype limits,
raw conditions/no simulation, SVG size/workspace/editor limits, batching setter limitations,
layout coordinate/rotation/auto-layout scope and content movement on section fitting. Update
FigJam aliases/styling/connectors and Slides layout scope. Update CLAUDE tool count from an
actual registration count (expected 64), module landmarks and real passing test counts.
Set both versions to 0.7.9 and add `## [0.7.9] - 2026-10-18`; preserve private packaging.

Index these audit/plan markdown documents in docs/superpowers/README.md. They are execution
records like the existing cross-file-search markdown plan; do not silently feed them to the
phase-2-to-6 generator, whose template hardcodes the old phase/spec/date. No generator rewrite
is needed to ship relay functionality. If adding rendered twins, first extend its metadata for
the correct date/spec rather than hand-editing a generated file; keep that optional docs work
separate from the product integration and verify checkbox counts.

- [ ] **Step 2: Run full automated and policy verification on the resolved candidate.**

Run from root: `bun run format`, then `bun run check`.
Run in plugin: `bun run typecheck` (explicit zero-error evidence).
Run from root: `bunx prettier --check "docs/**/*"`, `git diff --check`.
Run: `git grep -n -E 'figma-mcp-bridge|FIGMA_BRIDGE|Figma MCP Bridge' -- plugin server`.
Expected: both suites and builds pass, version check 0.7.9, formatting/diff checks pass; no
product old names (review any historical/comment hits). Verify no conflict markers or duplicate
case/schema/tool names, both package identities, stable manifest and `LOOPBACK_HOST` unchanged.
Read `.claude/skills/finish-task/SKILL.md` before the last product commit; apply verification,
fact refresh and bump steps, leaving dev/main merging and reviewer orchestration to the parent.

- [ ] **Step 3: Close the validated local upstream merge.**

Inspect `git diff --cached` against the intended whole integration and stage remaining intended
files explicitly. Commit the pending real merge as
`chore(upstream): integrate upstream v0.0.24 as relay 0.7.9`.
Run: `git merge-base --is-ancestor 2c37e6d HEAD` and `git show --no-patch --format='%H %P' HEAD`.
Expected: ancestor command exits 0 and merge has the prior relay/test commit and upstream as
parents. This is only the feature-branch integration merge, never a dev/main merge.

- [ ] **Step 4: Build/restart/relaunch the exact candidate for live Figma proof.**

Follow live-figma-check and `server/.smoke/README.md`. Use this worktree's slot. If no candidate
leader exists, run `node .smoke/hold-leader.mjs` from server as a managed process; otherwise
restart the candidate leader after schema/server changes. Build both packages and relaunch the
Dev plugin after the final plugin build in each affected file. Import only the generated dev
manifest. Do not edit client config; the smoke harness can join its held leader as a follower.

Run from server: `node .smoke/call.mjs list_files`, then use each returned fileKey explicitly.
Create clearly named scratch fixtures with run_script and record only their IDs for cleanup.
Cover this matrix, retaining isError and returned data evidence:

- Design: A/B navigation loop, nested trigger/conditional, overlay, variable/mode and instance
  sublayer; get_prototype_connections root/limits, get_node includePrototype and trace cycle/
  truncation; unloaded second-page root/target; missing destination where constructible.
- Design: raw and workspace-file create_svg, visible editable child vectors, width-only resize,
  invalid parent leaves no orphan. Exercise size/path failures before plugin send.
- Design, FigJam, Slides: two-node batch updates, grid, distribution, relative placement and
  duplicate offset on existing free nodes. Check unsupported same-parent/rotation/auto-layout
  cases where applicable. Section fit/section creation succeed in Design/FigJam and refuse Slides.
- FigJam: sticky/shape content and style edits, width/name/parent/style creator additions,
  section styling, floating/mixed/anchored labelled connectors and self-loop; move the parent
  section and endpoint nodes to validate local coordinates and attachment behavior. Check
  get_styles/get_variable_defs produce usable results or explicit availability notes.
- FigJam/Slides: prototype reads and design-only create_svg refuse with editor guidance;
  ordinary get_node still succeeds. Slides TEXT edits still succeed and styling still refuses.
- Regression: design get_design_context still returns code plus an actual image block, enriched
  serializer fields survive, FigJam generate_diagram still renders attached labelled connectors,
  and UI reconnect/collapse state still works after plugin relaunch.
- Confirm at least one node-addressed call in every new family travels through a real follower:
  the smoke probe loses election to the held candidate leader; supplied IDs must be honored.

Clean up only recorded scratch fixture IDs. A required unavailable editor/path blocks PR until
the parent obtains a specific explicit exception. Dev Mode stays unit-tested; do not add it to
the manifest to chase live coverage. If fixes change runtime code, rebuild, restart/relaunch and
repeat affected checks before claiming the candidate verified.

- [ ] **Step 5: Commit evidence and hand the exact candidate to the parent reviewer.**

Record actual commands/counts/build identities, live results and any specific blockers. Run
formatting/diff checks on the evidence doc and commit only docs as
`docs: record upstream relay integration verification`. Return final SHA, merge ancestry proof,
automated results, live evidence path and unresolved issues to the parent. Do not create a PR or
merge dev/main. Parent's GPT-6.1-Sol review covers the entire `origin/dev...HEAD` integration,
including upstream code, not only conflict resolutions; every subsequent fix gets fresh review
and affected verification before PR.

## Done when

- All seven audited change groups are delivered; ten new tools have complete schema/mapper/
  handler/dispatcher/capability wiring and no duplicate registrations.
- Relay names, private packaging, manifest, loopback/file safety, async serialization and existing
  FigJam/Slides/codegen/library/diagram behaviors survive.
- A real merge retains upstream ancestry; complete automated verification passes and required
  live evidence identifies the tested runtime, or a specific blocker is clearly returned.
- Parent receives the committed candidate for independent GPT-6.1-Sol review before any PR;
  the implementer has performed no dev/main merge, release or PR action.
