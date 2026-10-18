# Upstream relay audit and integration design - 2026-10-18

## Brief and evidence boundary

Inspect useful upstream changes missing from Figma Design Relay, preserve the fork's existing
contracts, and prepare implementation by the parent-selected Claude Opus 5.5 worker followed by
a separate GPT-6.1-Sol review. This is an architectural integration across the MCP schema,
follower transport and plugin dispatcher. The user authorizes routine design choices and the
execution handoff; this document does not introduce another approval gate.

This research task changes documentation only. No dependency installation, product edit, actual
merge, commit, live Figma mutation or PR was performed. Sources are the fetched Git objects and
the checked-out relay code, not unverified release descriptions.

- Worktree: `C:/Users/sadhu/.t3/worktrees/figma-design-relay/feat-upstream-relay-oct18`.
- Branch: `feat/upstream-relay-oct18`.
- Relay HEAD, `origin/main` and `origin/dev`: `55bd5eaf93696049fc1550d1893b38a5d81dfa0b`, version `0.7.8`.
- Incorporated upstream / merge base: `e8db933306ff9d1712fa97d4c91be8694e3587f3`.
- Audited upstream tip: `2c37e6dc3d2ccd903c98c4a6660a3c9c94cc447f`, version `0.0.24`.

Local `main` is ahead of those remote-tracking refs at `d0a3716` with the separate
`.playwright-mcp` ignore change (`09fe81d` through `65889c0`); it still reports version 0.7.8.
Do not reset or merge that work in this research task. The parent must reconcile concurrent
branch movement before its final review/integration, per finish-task.

Read `.claude/CLAUDE.md`, all four `.claude/rules/` files, and the `sync-upstream`,
`start-feature`, `finish-task`, `live-figma-check` and `add-mcp-tool` skills before execution.

## Upstream inventory

### U1: Prototype inspection - implement

Upstream `8607e6703fed13268d48214ea7a82a88fc20570d` (#62) adds
`plugin/src/main/prototype.ts`, two tools and `get_node.includePrototype`.

- `get_prototype_connections`: subtree scan including instance sublayers, full triggers/actions,
  destination screen/page resolution, variable and mode names, overlay settings and flow starts.
- `trace_prototype_flow`: breadth-first screen traversal, conditional branch paths, revisits,
  unresolved destinations and bounded pending screens.
- `get_node({ includePrototype: true })`: adds the bounded scan under `prototype`.

All three entry points are absent from the relay. `intent.ts:serializeReactions` only emits trigger
type and action type/destination/navigation; it cannot supply these inspection contracts.
Keep that compact serializer output unchanged by default; richer inspection is opt-in.

### U2: Editable SVG import - implement

Upstream `40c1a83194fd924d6de48681c5a63ed2524a8c8e` (#56) adds `create_svg`, raw SVG or a
workspace-local source file, a 2 MiB UTF-8 payload bound, SVG-root preflight and cleanup after a
placement failure. The relay has no such tool. `create_image` creates an image fill;
`import_html_layers` can render SVG embedded in an HTML serialization but does not expose the
standalone SVG contract. Neither supersedes this feature.

### U3: Batch node properties - implement

Upstream `088c811cca7e59099d571af99dc7f7a5c3abcab8` (#60) adds `nodeIds` to
`set_node_properties`, resolves the whole batch before mutation and preserves the singleton result
for one node. The relay's schema requires `nodeId`, its handler forwards one ID and its plugin
reads only `request.nodeIds[0]`. This gap is independent of editor support.

### U4: Seven layout helpers - implement

Also from `088c811`:

- `fit_to_content`: resize a section around its children with padding.
- `distribute_horizontally`, `distribute_vertically`: equal edge gaps along an axis.
- `align_to_grid`: snap local x/y to a positive grid size.
- `place_below`, `place_right_of`: position against another node with gap and start/center alignment.
- `duplicate_with_offset`: clone nodes and offset each clone relative to its original parent.

None is registered, validated or dispatched by the relay. `run_script` is an escape hatch rather
than the same supported tool surface. `generate_diagram` lays out newly generated diagrams; it
does not arrange existing arbitrary nodes.

### U5: FigJam text editing - implement

`088c811` resolves TEXT nodes or the `.text` sublayer of STICKY and SHAPE_WITH_TEXT for
`set_text_content` and `set_text_properties`. The relay's helper only accepts TEXT. Its capability
table allows `set_text_content` in FigJam, but that does not make sticky/shape labels editable.
`set_text_properties` is currently design-only. Existing Slides TEXT edits must continue to work.

### U6: Existing FigJam creator extensions - implement additively

`088c811` provides useful parameters missing from the relay's four existing creators:

- `create_sticky`: `name`, `parentId`, `isWideWidth`, optional `characters`.
- `create_shape_with_text`: `name`, `parentId`, `characters`, font family/style/size, rotation,
  fill/stroke and text fill colors/opacities, stroke weight.
- `create_connector`: floating coordinate endpoints, per-node anchor sides, name, parent and
  stroke styling. The relay already has attached endpoints and a text label, which must survive.
- `create_section`: `parentId`, fill color/opacity and `sectionContentsHidden`.

These are extensions, not four new tools. Preserve `text` as the relay's canonical spelling,
SQUARE as the shape default, existing return fields, paired dimensions for shape/section creation,
and the tested connector font/line-type fixes in `diagram.ts`.

### U7: FigJam read resilience - implement

`088c811` independently catches unavailable paint/text/effect style API calls in FigJam, skips
grid styles there, and returns a note when variable collection access fails. The relay calls all
four style APIs with one `Promise.all` and has no FigJam-specific variable fallback.
Return successful categories and actionable notes instead of silently converting all failures
to empty data. Keep design-editor failures visible and preserve the existing result keys.

### Already present or superseded - do not count as new work

- FigJam/Slides connection, metadata `editorType`, current-page reads, screenshots and editor
  capability gating: already delivered by the relay's phase 6.
- Basic stickies, shapes with text, sections and attached labelled connectors: already present.
- FigJam serialization: `figjam-serializer.ts` already emits `text`, topology, author, shapes,
  code blocks and tables, beyond upstream's two `characters` cases. Do not replace it or add a
  competing label field to the serialized-node contract.
- `get_layout_tree`'s optional `absoluteRenderBounds`: already handled, with a stronger bounded
  traversal in `layout-tree.ts`.
- FigJam auto-layout refusal: already enforced by `CAPABILITIES`. An explicit SECTION refusal
  may improve the design-editor error, but is hardening, not another feature.
- Upstream's broad edit-request set / `requireFigJamApi` is superseded by the relay's centralized
  capability table. Keep the table and add entries rather than restoring parallel gates.
- Upstream manifest `[figma, dev, figjam]` is unsuitable here: the known Figma restriction rejects
  `dev` with `figjam`, and dropping Slides would regress the relay.
- `10775da` changes upstream npm publishing/version commits; `691a825` and `2c37e6d` are release
  version commits. The fork already has private packages, committed version/changelog validation,
  node24 actions and a default-dry-run GitHub archive release. Keep those policies.
- `088c811` updates plugin typings to `^1.140.0` and adds a typed exhaustive FigJam-shape list.
  The accepted shape strings themselves are already identical. Treat this as build-time
  maintenance, not an extra meaningful user feature. If retaining the server's type-only import,
  put `@figma/plugin-typings: ^1.140.0` in server **devDependencies**, not runtime dependencies.

Conclusion: seven meaningful change groups, including ten new MCP tools, plus additive changes
to existing tools. Expected registration count is 64 from the current 54; verify from code.

## Integration decision and conflict forecast

Recommended: merge the pinned upstream tip into this existing isolated feature branch, resolve
the integration against this design, then review the entire resulting diff. This follows
`sync-upstream` and retains upstream ancestry. Reuse the current worktree rather than creating
another branch from dev; both remote integration branches currently equal its base.

Alternatives considered: cherry-picking only #62/#56 would lose #60's useful changes and violate
the ancestry rule. Copying selected patches followed by an `ours` merge would record ancestry
without honestly integrating the source and obscure future comparisons. Neither is recommended.

A read-only `git merge-tree e8db933 HEAD upstream/main` forecast produced conflict markers in
`.github/workflows/release.yml`, `README.md`, `plugin/manifest.json`, `plugin/package.json`,
`plugin/src/main/code.ts`, `plugin/src/main/serializer.ts`, `server/package.json` and
`server/src/tools.ts`. It is a textual forecast, not an actual merge or a complete semantic check.

Specific resolution rules:

- `schema.ts` textually merges without markers but can introduce duplicate creator declarations
  and object keys. Reconcile the existing FigJam shapes, schema exports and `rpcToArgs` by hand;
  do not treat a clean textual merge as correctness.
- `code.ts`: one case per request, centralized gating, async page loading, awaited serializer,
  injected prototype context, existing codegen/library/diagram logic and the UI state/collapse
  recovery must survive. Upstream's `get_node` uses a synchronous serializer; spreading that
  result verbatim would spread the relay's unresolved Promise.
- `serializer.ts`: keep the async enriched serializer and `FigJamFields.text` shape. Do not adopt
  upstream's early returns that omit relay reference resolution or child traversal.
- `tools.ts`: one registration per tool, retained `parseToolInput` refinements/aliases and shared
  `renderResponse`; preserve multipart design context, Code Connect and cross-file search.
- Manifest: keep name/id, permissions, `dynamic-page`, port-1994 stable policy and
  `[figma, figjam, slides]`; generated dev names must still include their port.
- Package versions: retain `0.7.8` while integrating; finish at `0.7.9` in both packages with the
  changelog entry. Keep private relay package/CLI names and repository URLs.
- Release workflow: retain the relay workflow wholesale. No npm publish, RELEASE_TOKEN,
  version-input commit/push flow or upstream action downgrade.
- Both lockfiles change upstream. Regenerate only for intentional dependency changes with Bun;
  retain relay workspace metadata and inspect the diff for upstream names/version drift.
- New `prototype.ts` merges cleanly as a file but references `figma` directly upstream. Refactor
  it to injected lookups before considering the merge complete.

At execution, use `git merge --no-commit --no-ff 2c37e6d` only after red regression tests exist.
Keep this local merge pending while resolving and validating the tasks; per-task changes may be
staged, but a commit while MERGE_HEAD exists closes the merge. Close it only after the complete
integrated candidate passes automated checks. No merge to dev/main, tag, release or PR is part of
the implementer's handoff; the parent owns those steps and the independent review.

## Contracts and design decisions

### D1: Prototype reads

Preserve upstream output schema version 1 and field names. Scan defaults/limits: `maxNodes` 5000,
range 1..50000; `includeEmpty` false. Trace defaults/limits: `maxScreens` 25, range 1..500;
`maxNodesPerScreen` 5000, range 1..50000. Page roots are valid for scans, not traces. DOCUMENT
roots are rejected. No root scans the current page. `get_node.includePrototype` uses scan defaults.

Prototype requests and the optional get-node scan work in `figma` and read-only `dev`; refuse
FigJam and Slides before scanning. Do not restrict ordinary `get_node`. Add a dedicated request
capability key `get_node_prototype`, invoked only for that flag, with displayed tool name
`get_node includePrototype`. Update capability regression tests so these explicit read entries
can allow dev while every write remains refused. Do not change the manifest to enable dev.

Export upstream's `ScanOptions`, `ScanResult`, `TraceOptions` and `FlowTrace` types. Extend the
three public functions with a required final `PrototypeContext` carrying async node/variable/
collection lookups, fileName and optional actual fileKey. No global `figma` in the module. Memoize
per request; load each containing page before reading children, including cross-page trace
targets. Treat null or throwing lookup of a referenced destination/variable as unresolved with
explicit status/null metadata, not a crash of unrelated connections. Root lookup errors remain
actionable tool errors. Preserve raw actions and nested conditions; never evaluate conditions or
follow URL/BACK/CLOSE/variable/media/in-screen actions as new screens. Keep cycles finite.

### D2: SVG

`create_svg({ source, name?, parentId?, x?, y?, width?, height?, fileKey? })` accepts inline SVG
with BOM/XML declaration/comments/DOCTYPE or a regular workspace-local file. Size cap is exactly
2097152 UTF-8 bytes, checked before transport and in the wire schema for `svgText`. URLs and data
URIs are not supported. Positive width/height may be supplied individually, retaining the other
dimension as upstream does. Restrict to the design editor, consistent with existing vector/image
import tools; the description's first sentence states that scope.

Extract `loadSvgSource(source: string, workspaceRoot: string): Promise<string>` into
`server/src/svg.ts`. Reuse `resolveWorkspacePath`/`isInsideWorkspace`, including valid `..icons`
paths, rather than upstream's overly broad `startsWith("..")` predicate. Preserve the upstream
single-descriptor regular-file, identity and post-open containment checks; read at most cap+1
bytes so a growing file cannot cause an unbounded read. Figma remains the actual SVG parser;
this preflight is not an XML sanitizer or a network fetcher.

Wire shape replaces `source` with `svgText`; it must survive follower validation. Validate parent
before creation, load page parents asynchronously, and remove a newly created SVG on any later
resize/append/position failure. Return upstream's nodeId/nodeName/nodeType/parentId/x/y/width/
height/childCount fields. Put plugin creation/cleanup in a small injected helper module.

### D3: Batch properties and layout

`set_node_properties` accepts the old `nodeId` or a nonempty `nodeIds`; when both are given,
`nodeIds` wins, matching upstream. Reject absent targets and empty property patches. Deduplicate
IDs in first-seen order. Transport IDs only on `nodeIds`; follower validation strips both
`nodeId` and `nodeIds` from params after validation. Preserve singleton output and return
`{ updatedCount, results }` for multiple unique nodes. Resolve and validate supported operations
for every target before writing; retain the relay's readonly FigJam corner-radius refusal.
Do not promise transaction rollback if Figma itself throws during later setters.

Use upstream layout input names, minimum cardinalities, default padding/gap 0 and align `start`.
Generic layout writes work in figma/FigJam/Slides, never dev; section fitting is figma/FigJam only.
Scope distribution/relative placement to distinct, unrotated sibling nodes under one manually
positioned parent; reject cross-parent, self-reference and parent auto-layout rather than mixing
coordinate systems. Grid uses local x/y with `Math.round(position / gridSize) * gridSize` and
also refuses parent-controlled auto-layout. Duplicate offsets are local to each original parent.
Preflight all inputs before mutation; remove clones if a duplication batch fails.

Distribution preserves first/last positions exactly, including floating point inputs; report
only interior nodes in `results`, with `movedCount = n - 2`. Equal negative gaps are allowed and
document overlap. Section fitting follows upstream's explicit local-layout behavior: keep section
origin fixed, shift children so their minimum x/y becomes padding, resize around their union.
Reject rotated children; an empty section becomes `max(2*padding, 0.01)` in each dimension.
Document that fitting can move content on the canvas; it is not a world-position-preserving crop.

### D4: FigJam additions

Normalize `characters` onto canonical `text` for sticky/shape creation; explicit `text` wins.
An omitted label creates an empty label, matching upstream; retain acceptance of `text: ""`.
Preserve existing `text` output and creator `type` fields, adding metadata without renaming keys.
Paired-size validation for existing shape/section tools remains; do not change their omitted-size
defaults. New SVG dimensions follow D2, not this paired-size rule.

For connectors, require exactly one representation per endpoint: node ID or both coordinates;
an anchor requires that endpoint's node ID. Preserve labels. Force ELBOWED before attaching
node magnets so toolbar state cannot break it; preserve CENTER for self-loops unless callers
explicitly choose sides. Extend `attachConnector` compatibly, retaining its current three-argument
behavior. Load label fonts with `labelFont`. Resolve parent and both node endpoints before creation,
validate they belong to the target page, and remove the new connector on failure. Coordinates
are local to the final parent; append before assigning endpoints and verify this live.

`set_text_content` and common text styling support TEXT/STICKY/SHAPE_WITH_TEXT through an injected
text-target helper. Report the outer node's id/name and edit its `.text` object. Font loading
handles mixed fonts before writes. TEXT-only alignment/auto-resize options on a FigJam text
sublayer are rejected before any mutation. Extend `set_text_properties` to figma/FigJam, keep its
existing Slides refusal and all Dev Mode write refusals.

Style/variable fallback is FigJam-specific. Keep successful style categories, return `grids: []`,
and include notes naming failed categories. Variables unavailable returns `{ collections: [], note }`.
Do not swallow a failure as success without a note, or change design-editor error behavior.

## Validation and known limits

Research baseline (Bun 1.4.0, 2026-10-18): plugin `bun test` passed 218 tests, 0 failed, 467
assertions. Server `bun test` exited 1: 238 passed, 6 failed/errors, 244 discovered; imports fail
with `Cannot find package 'zod'`. `bun run typecheck` in plugin exited 1 with
`bun: command not found: tsc`. Root/server/plugin node_modules directories are absent.
`bun scripts/check-version.mjs` passed with `0.7.8`. No complete baseline/build/format result is
claimed. No installs or generated builds were performed to bypass the research task's limits.

Implementation must install the existing lockfiles first, establish a green baseline, run red
behavior tests before merging upstream, and finish with both complete suites, zero plugin type
errors, both builds, formatting, version/changelog validation and name/safety checks. New tool
handler tests must exercise fileKey forwarding and a simulated follower `validateRpc` round trip.

Live evidence is required before PR: exact candidate source/build identity, dev slot/manifest,
restarted candidate leader, relaunched Dev plugins, affected paths in design/FigJam/Slides and at
least one node-addressed follower call (preferably each new family). Record hashes/results in
`docs/reference/2026-10-18-upstream-relay-live-check.md`. Dev Mode is stub-tested because the
manifest/paid seat excludes it. No new team-library success capability is being introduced.
If an affected editor or required live path is unavailable, the parent must obtain a specific
user exception before PR; the implementer must report the blocker, not waive it.

Known prior DNS-rebinding and WebSocket-origin/pairing concerns in the 0.7.8 project review are
not introduced or solved here. Do not broaden transport/security scope during the sync.

Implementation plan: [`../plans/2026-10-18-upstream-relay.md`](../plans/2026-10-18-upstream-relay.md).
