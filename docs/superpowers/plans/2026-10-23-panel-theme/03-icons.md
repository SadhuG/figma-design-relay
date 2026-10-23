# Phase 3: Icons

Back to [the overview](00-overview.md).

## Goal and scope

The panel draws the Rising sun app icon and chip glyphs, coloured through the role variables, so
they change with the theme.

- **In:** `plugin/src/ui/icons.tsx`, the icon wiring in `plugin/src/ui/App.tsx`.
- **Out:** colours other than the icons' own; the collapse chevron's button styling (phase 2).

## Requirements

- `AppIcon` takes `channel: "stable" | "dev"` and `state: "live" | "offline"` and draws the
  matching `App icon` variant. `faded` and its 0.4 opacity go: the Offline variant replaces them.
  Offline is shown while connecting and while lost, as in the screens.
- Chip glyphs, at 14 px in the footer and 12 px in the collapsed bar: working Pixel cursor, lost
  Moved, sent Selection out, syncing Outline stack, diagram Shape relay, leader Darts. The toggle
  uses Chevron up/down at 14 px.
- No hex values in the SVG markup. Glyph strokes use `currentColor`. App-icon parts use the roles
  `--sun-rising` (live sun), `--sun-set` (offline sun), `--line-horizon` (horizon), `--surface-ink`
  (Dev tile) and `--sun-on-ink` (sun on the tile).
- Unused icons (`SunIcon`, `PlaneIcon`, `CursorIcon`, `LostIcon`, `SelectionIcon`, `LayersIcon`,
  `DiagramIcon`) are deleted, not left beside the new ones.

## Tasks

### Task 1: Export and port the icons

**Files:**

- Modify: `plugin/src/ui/icons.tsx`, `plugin/src/ui/App.tsx`
- Test: `plugin/src/ui/icons.test.ts` (create)

- [x] **Step 1:** Export each needed variant of `Icon` (`71:93456`, page "Brand kit: Rising sun")
      and of `App icon` as SVG with `get_screenshot` (`format: "SVG"`), the instance ids taken from
      the light screens. Keep the path data; drop `width`/`height` attributes and hard-coded
      `stroke`/`fill` colours.
- [x] **Step 2: Write the failing test** `icons.test.ts`: render each exported component with
      `renderToStaticMarkup` from `react-dom/server` and assert "no icon markup contains a hex
      colour" and "every glyph strokes with currentColor". For `AppIcon`, assert that
      `{ channel: "dev", state: "live" }` references `var(--surface-ink)` and `var(--sun-on-ink)`,
      and `{ channel: "stable", state: "offline" }` references `var(--sun-set)`.
- [x] **Step 3:** Run `cd plugin && bun test src/ui/icons.test.ts`. Expected: FAIL.
- [x] **Step 4:** Write `AppIcon({ channel, state, size })`, `PixelCursorIcon`, `MovedIcon`,
      `SelectionOutIcon`, `OutlineStackIcon`, `ShapeRelayIcon`, `DartsIcon` and `ChevronIcon` (all
      `IconProps = { size: number }`, Chevron keeps `direction`). Use the 12 px drawing at size 12
      and the 14 px one otherwise; the set draws them separately.
- [x] **Step 5:** In `App.tsx`, point `CHIP_ICONS` at the new glyphs. `AppIcon` gets
      `channel={DEV_SLOT ? "dev" : "stable"}` and `state={connected ? "live" : "offline"}`. Delete
      the old icons.
- [x] **Step 6:** Run `bun test` and `bun run build` in `plugin/`. Expected: PASS, zero type
      errors.
- [x] **Step 7:** Relaunch the Dev plugin and compare its connecting, live, working and lost
      states with `00b`, `02`, `03d` and `07c` (dev slot screens).
- [x] **Step 8:** Commit `feat(plugin): draw the Rising sun app icon and glyphs`.

## Implementation notes

- The relay's `getMainComponentAsync` timed out on 2026-10-23. Instances export fine as SVG
  without it, and `componentProperties` names the variant.
- `react-dom/server` is part of the existing `react-dom` dependency; nothing new to install.

## Dependencies

Phase 2: the role variables the icons reference.

## Acceptance checks

- `bun test` passes, and no file under `plugin/src/ui/` imports a deleted icon.
- The live panel's icons match the screens in all four checked states.
