# Phase 5: Dev build height

Back to [the overview](00-overview.md).

## Goal and scope

The main thread knows at build time whether it is a dev build and opens the expanded window at 145
there, leaving stable at 121.

- **In:** `mainDefine` in `plugin/dev-slot.ts`, `plugin/vite.config.main.ts`,
  `plugin/src/main/panel-size.ts` (new), the sizing block in `code.ts`.
- **Out:** the Theme row itself (phase 6). Until phase 6 lands, the dev panel has 24 px of empty
  space at the bottom of its rows.

## Requirements

- Stable `dist/code.js` is unchanged apart from the sizing code: no slot name in it, and an
  expanded height of 121.
- One rule for both builds: `uiDefine` and `mainDefine` agree on the slot key.

## Tasks

### Task 1: Tell the main build its slot and size the window from it

**Files:**

- Create: `plugin/src/main/panel-size.ts`, `plugin/src/main/panel-size.test.ts`
- Modify: `plugin/dev-slot.ts`, `plugin/dev-slot.test.ts`, `plugin/vite.config.main.ts`,
  `plugin/src/main/code.ts:2506-2516`

**Interfaces:**

- Produces: `mainDefine(slot: DevSlot | null): Record<string, string>` in `dev-slot.ts`. In
  `panel-size.ts`: `UI_WIDTH = 320`, `UI_COLLAPSED_HEIGHT = 36` and
  `uiExpandedHeight(devBuild: boolean): number`.

- [ ] **Step 1: Write the failing tests.** `dev-slot.test.ts`: `mainDefine(null)` is `{}`;
      `mainDefine({ name: "panel-theme", port: 1995 })` is
      `{ "import.meta.env.VITE_FIGMA_DESIGN_RELAY_SLOT": '"panel-theme"' }`.
      `panel-size.test.ts`: `uiExpandedHeight(false) === 121`, `uiExpandedHeight(true) === 145`,
      `UI_COLLAPSED_HEIGHT === 36`.
- [ ] **Step 2:** Run `cd plugin && bun test dev-slot.test.ts src/main/panel-size.test.ts`.
      Expected: FAIL.
- [ ] **Step 3:** Implement `mainDefine` beside `uiDefine`, sharing the key string with it
      (extract a `SLOT_ENV_KEY` constant). Write `panel-size.ts` with a comment giving the sums
      (stable rows 81 + 4 + 36; dev adds 18 + 6).
- [ ] **Step 4:** Add `define: mainDefine(slot)` to `vite.config.main.ts`. In `code.ts`, import
      from `./panel-size` and use
      `uiExpandedHeight(Boolean(import.meta.env.VITE_FIGMA_DESIGN_RELAY_SLOT))` in `applyUiSize`
      and `showUI`.
- [ ] **Step 5:** Run `bun test`, then build twice. In the worktree: `dist/code.js` contains
      `"panel-theme"`. Stable, simulated by moving `.dev-slot.json` aside and building:
      `dist/code.js` contains no `panel-theme`. Put the slot file back and rebuild.
- [ ] **Step 6:** Commit `feat(plugin): size the dev panel for its extra row at build time`.

## Implementation notes

- `src/ui/env.d.ts` and `src/vite-env.d.ts` are both under `src/`, which `tsconfig.json` includes
  whole, so `import.meta.env.VITE_FIGMA_DESIGN_RELAY_SLOT` already type-checks in `src/main`. Don't
  add a third declaration.
- Without a define, Vite leaves `import.meta.env.<KEY>` undefined in the lib build. That is why
  stable needs no entry.

## Dependencies

None in code. The 121 figure assumes phase 2's row height.

## Acceptance checks

- `bun test` passes; the two build checks in step 5 hold.
- Live: the Dev plugin opens expanded at 145 px and collapses to 36.
