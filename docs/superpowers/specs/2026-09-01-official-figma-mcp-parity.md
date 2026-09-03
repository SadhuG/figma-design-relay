# Spec: Replacing the Official Figma MCP Server with Figma Design Relay

**Status:** Draft
**Date:** 2026-09-01
**Goal:** Make `figma-design-relay` a viable full-time replacement for Figma's
first-party MCP server for an agent doing design→code and code→design work,
without a paid Figma seat and without Figma API rate limits.

---

## 1. What we are comparing against

Two different first-party servers ship under the "Figma MCP" name. This spec
targets the **remote server**, because that is the one the official Claude Code
Figma plugin configures:

```json
{ "figma": { "type": "http", "url": "https://mcp.figma.com/mcp" } }
```

Its tool surface, taken verbatim from the plugin's `.mcp.json` (`figma_prod@2_2_96`):

`add_code_connect_map`, `create_new_file`, `generate_diagram`,
`generate_figma_design`, `get_code_connect_map`,
`get_code_connect_suggestions`, `get_context_for_code_connect`,
`get_design_context`, `get_figjam`, `get_libraries`, `get_metadata`,
`get_screenshot`, `get_variable_defs`, `search_design_system`,
`send_code_connect_mappings`, `upload_assets`, `use_figma`, `whoami`.

The second is the **Dev Mode local server** (Figma desktop app, `127.0.0.1:3845`),
whose surface is a subset plus `get_code` and `create_design_system_rules`. It
requires the desktop app and a Dev/Full seat, so it is out of scope as a
comparison baseline; anything we match on the remote server we also match there.

---

## 2. Where we are already capable

These are areas where the bridge **already meets or beats** the official server.

| Capability          | Bridge                                                                                                           | Official                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Cost / rate limits  | Unlimited; no Figma API calls at all                                                                             | Rate-limited; effectively a paid-seat feature                  |
| Live editor state   | Reads the actual open document, including unsaved edits                                                          | Reads Figma's server-side file state                           |
| Multi-file          | Registry keyed by `fileKey`; any number of open plugin instances                                                 | One file per call, by URL                                      |
| Screenshots to disk | `save_screenshots` writes PNG/SVG/JPG/PDF straight to the workspace                                              | Returns an inline image or a ~7-day-expiring asset URL         |
| Export formats      | PNG, SVG, JPG, PDF with `scale` and `clip` (absolute bounds)                                                     | PNG-ish screenshots                                            |
| Motion / animation  | 7 tools: list styles, read node motion, apply/remove animation styles, manual keyframe tracks, timeline duration | `get_motion_context` (read-focused)                            |
| HTML import         | `import_html_layers` bulk-imports an `html-to-figma` tree                                                        | No equivalent                                                  |
| Deployment          | `npx @gethopp/figma-design-relay`, works with Figma **web**, no desktop app                                        | Requires Figma auth; Dev Mode variant requires the desktop app |
| Transparency        | MIT, self-hostable, auditable                                                                                    | Closed, hosted                                                 |

The write surface is also genuinely broad already: 22 mutation tools covering
node properties, solid/gradient fills, effects, strokes, auto-layout, text
content and typography, frames/text/shapes/images, pages, duplicate, reparent,
group/ungroup, selection, viewport, and gated delete.

---

## 3. Where we are lacking

Ranked by how much each gap blocks "use the bridge instead of the official
server, every day."

### Gap 1 — No arbitrary Plugin API execution (`use_figma`) — **blocking**

The official server's single most important tool is `use_figma`: it runs
arbitrary JavaScript against the Figma Plugin API inside the file and returns
whatever the script returns. Everything the Plugin API can do is reachable
through it in one call.

The bridge instead exposes a fixed menu of ~40 hand-written RPCs. Anything not
on the menu is simply impossible. Concretely, an agent on the bridge today
**cannot**:

- create or edit components, component sets, variants, or component properties;
- create or edit instances, swap main components, or set instance overrides;
- author variables, variable collections, or modes, or bind variables to
  properties (`setBoundVariable`, `setBoundVariableForPaint`);
- create or apply paint / text / effect / grid **styles**;
- do boolean operations, vector editing, flatten, outline strokes;
- create sections, slices, or prototyping reactions / flows;
- set per-segment text styling (`setRangeFills`, `setRangeFontName`, …);
- set constraints, `layoutSizingHorizontal/Vertical`, absolute positioning,
  `layoutPositioning`, grid layout;
- read or write plugin data, annotations, dev resources, or export settings;
- run `node.query()` / `findAll` searches, or any read the serializer omits.

Closing this one gap subsumes most of the rest of the list. This is Phase 1.

### Gap 2 — Serialized nodes drop design-system identity — **blocking for design→code**

`plugin/src/main/serializer.ts` emits geometry, paints, effects, auto-layout,
constraints and text properties, but it omits every field an agent needs to
write _correct_ code instead of pixel-matched code:

- `componentId` / `mainComponent` / `componentProperties` / `variantProperties`
  — so an instance of `Button/Primary` looks like an anonymous frame.
- `boundVariables` — so a fill bound to `color/brand/primary` serializes as a
  raw hex, and the agent hardcodes `#3B82F6` instead of using the token.
- `fillStyleId` / `strokeStyleId` / `textStyleId` / `effectStyleId` — same
  problem for styles.
- `layoutSizingHorizontal` / `layoutSizingVertical` / `layoutPositioning` /
  `layoutGrow` — so hug/fill intent is lost and the agent emits fixed sizes.
- `reactions`, `exportSettings`, `annotations`, `absoluteRenderBounds`.

The official `get_design_context` surfaces all of this as tokens, Code Connect
snippets and annotations.

### Gap 3 — `get_design_context` returns a raw tree, not code + image + hints

Official `get_design_context` returns, in one call: React + Tailwind reference
code, a screenshot, CSS-variable token names, design annotations, Code Connect
snippets, and asset URLs for every icon/image. The bridge returns a
depth-limited JSON tree and nothing else — the agent must separately call
`get_screenshot` and `get_variable_defs` and then invent the mapping itself.

### Gap 4 — No Code Connect

Five official tools (`get_code_connect_map`, `add_code_connect_map`,
`get_code_connect_suggestions`, `get_context_for_code_connect`,
`send_code_connect_mappings`) tie Figma component keys to real codebase
components. The bridge has none. This is the mechanism that makes agent output
use _your_ `<Button>` rather than a fresh div.

Notably, the read direction is fully reproducible offline: Code Connect
mappings live in `*.figma.ts` files **in the user's repo**, and the plugin can
supply component keys. We do not need Figma's cloud for it.

### Gap 5 — No cross-file / library search

`search_design_system` and `get_libraries` search an org's published libraries.
The bridge sees only files where the plugin is currently open. Partially
closable: the Plugin API exposes
`figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`,
`figma.variables.importVariableByKeyAsync()`, and
`figma.importComponentByKeyAsync()` — but the manifest needs the `teamlibrary`
permission, and there is no full-text component search.

### Gap 6 — Design-only editor support

`manifest.json` declares `"editorType": ["figma", "dev"]`. FigJam and Slides
files are unreachable, so `get_figjam` and `generate_diagram` (Mermaid → FigJam)
have no counterpart.

### Gap 7 — Structural limits we cannot close

State these plainly rather than pretending otherwise:

- **`create_new_file` is impossible.** The Plugin API cannot create documents.
  The bridge can only `create_page` inside an already-open file. Mitigation:
  document that the user creates the file and opens the plugin once.
- **The plugin must be open in the target file.** The official server addresses
  any file the user can access, by URL. The bridge cannot act on a pasted link
  to a file nobody has open. Mitigation: `list_files` plus an error message that
  tells the agent exactly what to ask the user for.
- **No branch (`branchKey`) addressing.**
- **`generate_figma_design`** is a Figma-hosted generative model. Not
  replicable; `import_html_layers` covers an overlapping need differently.
- **Scripts are not atomic.** Official `use_figma` documents that a failed
  script makes no changes. The Plugin API has no rollback, so a bridge script
  that throws halfway leaves partial mutations. This must be documented, not
  papered over.

### Gap 8 — No tests

There is no test runner, no test file, and no CI job beyond `release.yml`. The
project is ~5,200 lines of protocol-sensitive code (leader election, RPC
validation, a 1,875-line plugin dispatcher) verified entirely by hand. Any plan
that meaningfully grows the surface has to fix this first.

---

## 4. Feasibility check: can the plugin sandbox run `eval`?

Yes. Figma's plugin sandbox is a Realms-based sandbox that Figma's own
engineering blog describes as implemented with `with (scopeProxy) { eval(userCode) }`,
and it explicitly "includes a new copy of the `eval` function." Community
plugins that execute user-authored Plugin API code (Scripter, Figlet) rely on
this. Plugin code therefore has a working **direct** `eval` whose scope chain
includes the sandbox's scope proxy, which is what makes the `figma` global
resolve inside evaluated source.

Two consequences for the design:

1. Use **direct** `eval(source)`, not `(0, eval)(source)`. Indirect eval runs in
   the realm's global scope, where `figma` may not be reachable.
2. Evaluate `(async () => { <code> })` and call the result, so user code gets
   both top-level `await` and `return` — matching `use_figma` semantics exactly.

Phase 1 still probes this at runtime and fails with an explicit, actionable
error rather than a confusing `ReferenceError`, so a future sandbox change is
diagnosable.

---

## 5. Target: phased roadmap

Each phase is independently shippable and independently useful.

| Phase | Deliverable                                                                                               | Closes       | Requirements |
| ----- | --------------------------------------------------------------------------------------------------------- | ------------ | ------------ |
| **1** | Test harness + `run_script` (a `use_figma` equivalent)                                                    | Gap 8, Gap 1 | R1–R10       |
| **2** | Serializer enrichment: components, bound variables, style IDs, layout sizing, annotations                 | Gap 2        | R11–R19      |
| **3** | `get_design_context` v2: reference code + inline screenshot + token names + asset export, in one response | Gap 3        | R20–R27      |
| **4** | Code Connect: parse local `*.figma.ts`, map component keys, surface snippets in design context            | Gap 4        | R28–R35      |
| **5** | Library reach (`teamlibrary` permission, import-by-key, variable collections) + `whoami`                  | Gap 5        | R36–R42      |
| **6** | FigJam / Slides editor support + Mermaid→FigJam diagram tool                                              | Gap 6        | R43–R50      |

Phases 2–6 depend on Phase 1 only for its test harness, not for `run_script`
itself; but `run_script` makes each of them dramatically cheaper to prototype,
which is why it goes first. Two ordering constraints are real rather than
preference: Phase 3 needs Phase 2's resolved token and style names (R14, R15) to
generate code that references tokens, and Phase 4 needs Phase 2's component
property definitions (R13) to author accurate mappings.

Every phase has its own plan, one per phase rather than one for all six:

| Phase | Plan                                                                      |
| ----- | ------------------------------------------------------------------------- |
| 1     | `docs/superpowers/plans/2026-09-01-run-script-plugin-api-escape-hatch.md` |
| 2     | `docs/superpowers/plans/2026-09-01-serializer-enrichment.md`              |
| 3     | `docs/superpowers/plans/2026-09-01-design-context-v2.md`                  |
| 4     | `docs/superpowers/plans/2026-09-01-code-connect.md`                       |
| 5     | `docs/superpowers/plans/2026-09-01-library-reach.md`                      |
| 6     | `docs/superpowers/plans/2026-09-01-figjam-slides-diagrams.md`             |

---

## 6. Requirements (normative)

Requirements are numbered continuously across the whole roadmap so a task in any
plan can cite one unambiguously. Phase 1's `R1`–`R10` are already cited by
`docs/superpowers/plans/2026-09-01-run-script-plugin-api-escape-hatch.md` and
must not be renumbered.

| Phase | Requirements | Depends on                                       |
| ----- | ------------ | ------------------------------------------------ |
| 1     | R1–R10       | —                                                |
| 2     | R11–R19      | Phase 1's test harness (R10)                     |
| 3     | R20–R27      | Phase 2 (R14, R15) for token and style names     |
| 4     | R28–R35      | Phase 2 (R13) for component property definitions |
| 5     | R36–R42      | Phase 1's test harness (R10)                     |
| 6     | R43–R50      | Phase 1's test harness (R10)                     |
| All   | R51–R55      | —                                                |

### 6.1 Phase 1 — `run_script` (R1–R10)

Closes Gap 1 and Gap 8. Planned in
`docs/superpowers/plans/2026-09-01-run-script-plugin-api-escape-hatch.md`.

- **R1.** The bridge exposes an MCP tool `run_script` taking `code` (string) and
  optional `fileKey`.
- **R2.** `code` executes inside the Figma plugin sandbox with the Plugin API in
  scope as `figma`, supporting top-level `await` and top-level `return`.
- **R3.** The value returned by the script is JSON-serialized and returned to
  the agent. Figma node objects collapse to `{ id, name, type }`; `figma.mixed`
  and any other symbol serializes as `"mixed"`; circular references become
  `"[circular]"`.
- **R4.** Results are bounded: max serialization depth 12, max 500 array items
  per array, max 200,000 characters of JSON. Exceeding the character cap returns
  a flagged, truncated preview rather than an oversized WebSocket frame.
- **R5.** Scripts are capped at 100,000 characters, enforced both by the server's
  Zod schema and by the plugin runner.
- **R6.** A script that throws returns the error as an MCP error result carrying
  `name: message`, not a silent success.
- **R7.** `run_script` is rejected in Dev Mode with the same clear message the
  other edit tools use, since Dev Mode is read-only.
- **R8.** The tool description tells the agent the non-obvious sandbox rules it
  must follow: return to output, load fonts before text mutation, colors are
  0–1, fills are read-only arrays, `await figma.setCurrentPageAsync()` to switch
  pages, work incrementally, and **scripts are not atomic**.
- **R9.** The follower→leader RPC path validates `run_script` like every other
  tool, via `rpcInputSchemas` / `rpcToArgs`.
- **R10.** `bun test` runs in both `server/` and `plugin/` and is green.

### 6.2 Phase 2 — Serializer enrichment (R11–R19)

Closes Gap 2. Everything here lands in `plugin/src/main/serializer.ts` and
propagates automatically to `get_document`, `get_node`, `get_selection` and
`get_design_context`, which all serialize through it.

- **R11.** `serializeNode` becomes asynchronous. `manifest.json` declares
  `"documentAccess": "dynamic-page"`, under which the synchronous accessors this
  phase needs are unavailable — component identity must come from
  `instance.getMainComponentAsync()`, styles from `figma.getStyleByIdAsync()`,
  and variables from `figma.variables.getVariableByIdAsync()`. Every call site in
  `plugin/src/main/code.ts` awaits the new signature.
- **R12.** `INSTANCE` nodes carry `mainComponent: { id, key, name }` plus
  `componentProperties` as a map of property name to `{ type, value }`, so an
  instance of `Button/Primary` is recognisable as one.
- **R13.** `COMPONENT` and `COMPONENT_SET` nodes carry `key`, and
  `componentPropertyDefinitions` is read **only** from the owning node: use the
  node itself when it is a `COMPONENT_SET`, use a `COMPONENT` only when its
  parent is not a `COMPONENT_SET`, and otherwise promote a variant `COMPONENT` to
  its parent set. Reading the getter off a variant is an error the serializer
  must not make.
- **R14.** Every node emits `boundVariables` resolved to human-readable form —
  `{ property, variableId, variableName, collectionName }` — including
  paint-level bindings such as `fills[i].boundVariables.color`. A fill bound to
  `color/brand/primary` must not serialize as a bare hex.
- **R15.** Style references are emitted with resolved names: `fillStyleId`,
  `strokeStyleId`, `effectStyleId`, `gridStyleId` and `textStyleId`, each as
  `{ id, name }`. A style id of `figma.mixed` serializes as `"mixed"`, matching
  R3's convention.
- **R16.** Layout intent is emitted, not just geometry:
  `layoutSizingHorizontal`, `layoutSizingVertical`, `layoutGrow`, `layoutAlign`,
  `layoutPositioning`, `itemReverseZIndex`, and the `minWidth` / `maxWidth` /
  `minHeight` / `maxHeight` constraints. Without these, hug and fill intent is
  lost and an agent emits fixed pixel sizes.
- **R17.** `reactions` (prototyping triggers, actions and destinations),
  `exportSettings`, and both `absoluteBoundingBox` and `absoluteRenderBounds` are
  emitted.
- **R18.** Dev Mode `annotations` are emitted verbatim, including their label and
  any pinned properties, so designer notes reach the agent.
- **R19.** Payload discipline: every field added by R12–R18 is **omitted when
  absent, empty, or at its default**, and a regression test asserts that a plain
  rectangle with no component, variable, style or annotation serializes to the
  same shape it does today. Enrichment must not make `get_document` unusable on
  a large page.

### 6.3 Phase 3 — `get_design_context` v2 (R20–R27)

Closes Gap 3. This is the tool an agent reaches for first when implementing a
design, so it has to answer the whole question in one call.

- **R20.** `get_design_context` accepts an optional `nodeId`. When given, it
  serializes that subtree; when omitted it keeps today's behaviour of using the
  selection, falling back to the current page.
- **R21.** The response is a **multi-part MCP result**: a text block carrying
  reference code and the token list, plus an `image` content block carrying the
  node's screenshot. Returning a base64 blob inside a text block, as
  `get_screenshot` does today, does not satisfy this.
- **R22.** Reference-code generation lives in a pure, server-side module under
  `server/src/codegen/` that takes the serialized tree and returns a string. It
  must not run inside the plugin sandbox. A `format` parameter selects `"react"`
  (default), `"html"`, `"css"` or `"json"`.
- **R23.** Wherever a node carries a bound variable or a named style (R14, R15),
  the generated code references the **token or style name**, not the resolved hex
  or pixel value. Raw values appear only where no binding exists.
- **R24.** Icons and images in the subtree are exported to disk under a
  caller-supplied directory and referenced by workspace-relative path. This is a
  deliberate divergence from the official server, which returns asset URLs that
  expire in about seven days; local files are committable. The response text must
  instruct the agent to reference those files rather than hand-writing `<svg>`
  markup it has no vector data for.
- **R25.** When Phase 4 has landed, hints are applied in priority order: Code
  Connect snippet, then component description, then annotation, then design
  token, then raw value. The response states which source it used per node, so
  the agent can tell a mapped component from a guessed one.
- **R26.** The response is bounded by the same discipline as R4 — a `depth`
  parameter, and a documented character cap with a flagged truncation — so a
  large frame degrades rather than fails.
- **R27.** Codegen is covered by golden-file tests: a fixture serialized tree in,
  an expected code string out, one fixture per `format`.

### 6.4 Phase 4 — Code Connect (R28–R35)

Closes Gap 4. The read direction needs no Figma cloud access at all: the
mappings are files in the user's own repository.

- **R28.** The server discovers Code Connect files matching
  `**/*.figma.{ts,tsx,js,jsx}` under its working directory. Discovery is
  **contained**: a path that resolves outside the working directory is rejected,
  matching the containment rule `import_html_layers` already enforces.
- **R29.** Each `figma.connect(...)` call is parsed into a mapping record
  carrying the Figma file key and node id from the URL argument, the code
  component name, its import path relative to the workspace, and its declared
  props mapping. A file that fails to parse is reported by path and skipped, not
  silently dropped.
- **R30.** `get_code_connect_map` returns the mappings for a given `fileKey`, or
  for a list of `nodeIds`, as `{ nodeId, component, source, props }`.
- **R31.** `add_code_connect_map` **writes a local file** rather than calling
  Figma. It takes a node id, a component name and a source path, and creates or
  extends the appropriate `*.figma.ts` file. The tool description states that the
  mapping is a workspace file, not a cloud record.
- **R32.** `get_code_connect_suggestions` proposes mappings by matching unmapped
  component names in the open Figma file against exported component names found
  in the workspace, returning ranked candidates with the evidence for each match.
  It never writes.
- **R33.** `get_context_for_code_connect` returns a component's property
  definitions and variant axes so a mapping can be authored accurately. It
  depends on R13.
- **R34.** There is **no** `send_code_connect_mappings` equivalent. The bridge's
  substitute is that mappings are files under version control, and the
  documentation says so explicitly rather than leaving the absence unexplained.
- **R35.** When a node in a `get_design_context` response has a mapping, the
  snippet is surfaced in that response at the priority R25 defines.

### 6.5 Phase 5 — Library reach and identity (R36–R42)

Closes Gap 5. This is the phase most constrained by what the Plugin API actually
exposes, so its requirements are deliberately narrower than the official tools.

- **R36.** `plugin/manifest.json` requests the `currentuser` and `teamlibrary`
  permissions. The manifest change is user-visible on plugin import, so the
  README explains why each is needed.
- **R37.** `whoami` returns `figma.currentUser` as `{ id, name, photoUrl }`.
  `figma.currentUser` can be `null`; the tool returns an explicit "no current
  user" result rather than an empty object.
- **R38.** `get_libraries` returns available team library variable collections
  via `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`,
  including each collection's library name and key.
- **R39.** Import-by-key is exposed for the four importable kinds:
  `figma.importComponentByKeyAsync`, `figma.importComponentSetByKeyAsync`,
  `figma.importStyleByKeyAsync` and `figma.variables.importVariableByKeyAsync`.
  Each returns the imported node or object's id so a following call can place or
  bind it.
- **R40.** `search_design_system` is implemented as a **narrower** tool than the
  official one, and its description says so in the first sentence. The Plugin API
  has no full-text search across an organisation's published libraries, so the
  bridge searches what it can actually reach: available library variable
  collections, and components already present or instantiated in the connected
  files. The description must stop an agent assuming org-wide coverage.
- **R41.** When a team-library call is refused because the account's plan or
  permissions do not allow it, the error names the permission and the plan
  requirement rather than surfacing a raw API error.
- **R42.** Every tool in this phase has unit tests against stubbed
  `figma.teamLibrary` and `figma.currentUser` objects, so the suite runs without
  a Figma session.

### 6.6 Phase 6 — FigJam, Slides and diagrams (R43–R50)

Closes Gap 6. The bridge is design-file-only today because of one line in the
manifest; everything downstream of changing it needs care.

- **R43.** `plugin/manifest.json` declares
  `"editorType": ["figma", "figjam", "slides", "dev"]`.
- **R44.** The current design-editor gate (`EDIT_REQUEST_TYPES` plus
  `requireEditorMode`) is replaced by an **editor-aware capability table**. Node
  types and APIs differ per editor — `figma.createPage()` does not exist in
  FigJam or Slides, sticky notes and connectors exist only in FigJam, slide nodes
  only in Slides — and a tool unavailable in the current editor is rejected up
  front with a message naming the editor it needs.
- **R45.** FigJam documents serialize `STICKY`, `CONNECTOR`, `SHAPE_WITH_TEXT`,
  `CODE_BLOCK`, `SECTION` and `TABLE` nodes, including connector endpoints, so a
  diagram's topology survives the round trip.
- **R46.** A FigJam write surface covers creating sticky notes, connectors,
  shapes-with-text and sections, matching the shape of the existing design write
  tools — validated Zod input, `fileKey` routing, node ids returned.
- **R47.** Slides support is scoped explicitly: read and screenshot are
  supported; write is limited to text and frame content inside existing slides.
  Creating slide structure is out of scope for this phase, and the documentation
  says so.
- **R48.** `generate_diagram` accepts Mermaid source and renders it into a FigJam
  board. The supported subset is fixed and documented: flowchart, sequence,
  entity-relationship, and state diagrams.
- **R49.** Mermaid input outside the supported subset returns an error naming the
  diagram type it received and listing the supported ones. It never renders a
  partial or approximate diagram.
- **R50.** A regression suite proves the design-file behaviour of every existing
  tool is unchanged by the manifest and gate changes.

### 6.7 Cross-cutting (R51–R55)

These apply to every tool added by any phase.

- **R51.** Every new tool registers a Zod schema in `toolInputSchemas` and a
  mapper in `rpcToArgs`, so the follower→leader RPC path validates it. The
  `Record<ToolName, …>` typing makes omitting the mapper a compile error; do not
  work around it.
- **R52.** Every new tool accepts the optional `fileKey` parameter and routes
  through `node.sendWithParams`, so multi-file workflows keep working.
- **R53.** Every new module has unit tests, and `bun test` stays green in both
  `server/` and `plugin/`.
- **R54.** Every new tool is added to the README's tool table, and any behaviour
  that diverges from the official server is called out in the Editing Notes.
- **R55.** Errors say what to do next, not just what went wrong. "Open the plugin
  in the target file and retry" beats "Plugin not connected"; naming the missing
  permission beats surfacing the raw API error.
