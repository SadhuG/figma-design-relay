---
paths:
  - "plugin/**"
---

# Plugin rules

## Landmarks

- `plugin/src/main/code.ts:402` — the dispatcher calls `assertEditorSupports` before any tool runs.
- `plugin/src/main/capabilities.ts:58` — `CAPABILITIES`; `:113` — `assertEditorSupports`, which
  takes the editor as a parameter rather than reading `figma.editorType`, so the gate is
  unit-testable. **The table is keyed by the request type the plugin receives, not the MCP tool
  name** — `generate_diagram` arrives as `render_diagram`, and an entry under the tool name never
  matches; `tool` on an entry sets the name the refusal shows. Tools absent from the table run
  everywhere. `capabilities.regression.test.ts` fails if a tool turns design-only without being
  listed.
- `plugin/src/main/serializer.ts:484` — `serializeNode`, `async` and awaited at four call sites in
  `code.ts`. Only `get_design_context` type-errors if you forget an `await` — the other three type
  `data` as `unknown` and will happily ship an unresolved promise. The `figma` lookups it hands to
  `references.ts` live at `:412`; the helper modules never name the global.
  `docs/reference/serialized-nodes.md` documents the emitted shape — update it with the serializer.
- `plugin/src/main/code.ts:2124` — the UI-collapse block that closes the file: window sizing, the
  `ui-collapsed` `figma.clientStorage` key, and the `request-ui-state` / `set-ui-collapsed`
  messages. `figma.showUI` runs with `visible: false` and the panel is shown only once the stored
  state resolves, so anything that returns early before `figma.ui.show()` leaves the window
  invisible. Came from upstream `ef0cf04`; leave it alone when editing the dispatcher above it.

## Constraints

- **Imports are extensionless** (`./serializer`); Vite resolves them.
- **Type-check stays at zero errors.** `vite build` strips types without checking them, so `build`
  runs `typecheck` first. If `tsc` complains, fix the code, not the tsconfig.
- **`documentAccess: "dynamic-page"`** — synchronous accessors do not work. Use
  `figma.getNodeByIdAsync`, `instance.getMainComponentAsync()`, `figma.getStyleByIdAsync`,
  `figma.variables.getVariableByIdAsync`.
- **New modules must not reference the `figma` global.** Take lookups as parameters; that is the
  only reason they can be unit-tested under Bun.
- **Reading a permission-gated global is what throws.** Without `teamlibrary` in the manifest, the
  property read `figma.teamLibrary` throws before any method runs, so passing it as an argument
  escapes every try/catch in the callee. Pass a getter (`() => figma.teamLibrary`) and read it
  inside `withPermissionContext`. Same for `figma.currentUser`.
- **Direct `eval`, never `(0, eval)`.** Figma wraps plugin code in `with (scopeProxy) { … }`; only a
  direct eval inherits that scope and resolves `figma`. Isolated in `src/main/eval-direct.ts`.
- **Scripts are not atomic.** The Plugin API has no rollback, so a `run_script` that throws
  part-way leaves its earlier mutations. Say so in docs; do not paper over it.
- **Tools are gated per editor before they run.** The plugin runs in design files, FigJam and
  Slides. `figma.createPage()` exists only in design files; `createSticky`, `createConnector` and
  `createShapeWithText` only in FigJam. **A new write tool gets a `CAPABILITIES` entry in the same
  commit.**
- **A new FigJam connector is not in a known state.** It takes the line type last picked in the
  user's toolbar, and a `STRAIGHT` one refuses every magnet but `CENTER` and `NONE`; its
  `text.fontName` is `{ family: "", style: "" }` until it has text, and loading that throws. Attach
  through `attachConnector` and load label fonts through `labelFont` (`diagram.ts`). Both passed
  every unit test and failed on the first live board.
- **`editorType` cannot hold both `dev` and `figjam`.** A manifest Figma rejects closes the plugin
  instead of hot-reloading it — it drops off `list_files` and no rebuild revives it; relaunch from
  the Development menu. Phase 6 dropped `dev` (R43). The table still carries Dev Mode rules so `dev`
  can return with one manifest line, but **Dev Mode needs a paid seat this project does not have**:
  verify those rules with `capabilities.test.ts` and budget no manual Dev Mode step. Annotations
  are the exception — `node.annotations = [{ label: "…" }]` in a `run_script` writes one from the
  design editor.
- **No account here can use team library APIs** — they need an Organization or Enterprise plan, and
  no published library is available. Cover library success paths with stubbed `figma.teamLibrary`
  and importers (`src/main/library.test.ts`), check the refusal path live, and budget no live
  team-library step. `docs/guides/libraries.md` lists what is still unverified.
- **`plugin/manifest.json` is the stable manifest; never edit it for a dev build.** In a feature
  worktree the build derives the Dev manifest from it (`dev-slot.ts`: name, id, `main`/`ui` paths,
  and `allowedDomains` narrowed to the slot's port) and writes it to `dist/`. Any other manifest
  change — permissions, `editorType` — reaches both builds.
- **Relaunch the plugin after every plugin rebuild** before trusting a live check — see the
  `live-figma-check` skill.
