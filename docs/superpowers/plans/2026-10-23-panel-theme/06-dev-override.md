# Phase 6: Dev theme override

Back to [the overview](00-overview.md).

## Goal and scope

A dev build shows a **Theme** row under Relay whose switch overrides Figma's theme and remembers it.
The stable build shows, applies and stores none of it.

- **In:** `plugin/src/theme-override.ts` (new, shared by main and UI), override rules in
  `plugin/src/ui/theme.ts`, the storage and messages in `code.ts`, the row and switch in `App.tsx`
  and `index.css`.
- **Out:** any stable-build setting.

## Requirements

- The override is `ThemeOverride = "light" | "dark" | null`; `null` follows Figma.
- Click rule: the new theme is the opposite of the one in effect; the override becomes that theme,
  or `null` if it equals Figma's.
- Row text: `Light · Figma`, `Dark · Figma`, `Light · override`, `Dark · override`.
- An override stays put when Figma's theme changes.
- Messages. UI → main: `{ type: "set-theme-override", override }`. Main → UI:
  `{ type: "ui-theme-override", payload: { override } }`, posted wherever `postUiCollapseState`
  is (start-up and `request-ui-state`).
- The UI sets `document.documentElement.dataset.theme` to the override, or deletes it for `null`,
  and does so only when `DEV_SLOT` is set.
- The switch is a `button` with `role="switch"`, `aria-checked` true for dark, and
  `aria-label="Dark theme"`. Its styles follow `Theme toggle`'s `Size=Small` variants: track
  32 × 18, knob 14, sun glyph in `--sun-rising` and moon glyph in `--text-primary`. The track is
  `--surface-well` with a 1 px `--line-hairline` border, and the knob `--surface-raised`.

## Tasks

### Task 1: The stored value

**Files:**

- Create: `plugin/src/theme-override.ts`, `plugin/src/theme-override.test.ts`

**Interfaces:**

- Produces: `type ThemeOverride = "light" | "dark" | null`;
  `THEME_OVERRIDE_KEY = "theme-override"`; `parseThemeOverride(value: unknown): ThemeOverride`.

- [x] **Step 1: Write the failing tests:** `"light"` → `"light"`, `"dark"` → `"dark"`, and `null`,
      `undefined`, `"blue"`, `1`, `{}` and `"Dark"` → `null`.
- [x] **Step 2:** Run `cd plugin && bun test src/theme-override.test.ts`. Expected: FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run. Expected: PASS. Commit `feat(plugin): parse the stored theme override`.

### Task 2: The override rules

**Files:**

- Modify: `plugin/src/ui/theme.ts`, `plugin/src/ui/theme.test.ts`

**Interfaces:**

- Consumes: `Theme` (phase 4), `ThemeOverride` (task 1).
- Produces: `resolveTheme(figma: Theme, override: ThemeOverride): Theme`;
  `nextOverride(figma: Theme, override: ThemeOverride): ThemeOverride`;
  `themeRowText(figma: Theme, override: ThemeOverride): string`.

- [x] **Step 1: Write the failing tests.** `resolveTheme`: all six combinations. `nextOverride`:
      `("light", null) → "dark"`, `("dark", null) → "light"`, `("light", "dark") → null`,
      `("dark", "light") → null`, `("dark", "dark") → "light"` (an override left equal by a Figma
      change flips away from Figma). `themeRowText`: `("dark", null) → "Dark · Figma"`,
      `("light", "dark") → "Dark · override"`, `("dark", "dark") → "Dark · override"`.
- [x] **Step 2:** Run `bun test src/ui/theme.test.ts`. Expected: FAIL.
- [x] **Step 3:** Implement the three functions.
- [x] **Step 4:** Run. Expected: PASS. Commit `feat(plugin): theme override rules`.

### Task 3: Storage, messages and the Theme row

**Files:**

- Modify: `plugin/src/main/code.ts` (sizing block), `plugin/src/ui/App.tsx`,
  `plugin/src/ui/icons.tsx`, `plugin/src/ui/index.css`, `plugin/src/ui/styles.test.ts`

- [x] **Step 1:** Extend `styles.test.ts`: `.theme-switch uses only role variables` (covered by the
      existing rule once the class exists) and `the switch is 32 × 18 with a 14 px knob`. Run it.
      Expected: FAIL.
- [x] **Step 2:** In `code.ts`, read `THEME_OVERRIDE_KEY` alongside `UI_COLLAPSED_KEY` before
      `figma.ui.show()`, holding `themeOverride` parsed with `parseThemeOverride`. Add
      `postUiThemeOverride()` and call it wherever `postUiCollapseState()` runs. Handle
      `set-theme-override` the same way as `set-ui-collapsed`: parse, keep, and store best-effort.
      A failed read keeps `null` and still shows the window.
- [x] **Step 3:** In `App.tsx`, behind `DEV_SLOT`: `override` state set from `ui-theme-override`;
      an effect that writes or removes `data-theme`; and a fourth row `Theme` with a `ThemeSwitch`
      showing `resolveTheme(figma, override)` and the `themeRowText` value. Clicking computes
      `nextOverride`, sets the state and posts `set-theme-override`. Add `SunIcon` and `MoonIcon`
      (10 px glyphs, `currentColor`) to `icons.tsx`, drawn as in `Theme toggle` (`97:795`).
- [x] **Step 4:** Add `.theme-switch` styles, with a 150 ms knob transition. Run `bun test` and
      `bun run build`. Expected: PASS, zero type errors.
- [x] **Step 5:** Build checks. Dev `dist/index.html` contains `· override`. Built with
      `.dev-slot.json` moved aside, it doesn't, and neither does `role="switch"`. Restore and
      rebuild.
- [x] **Step 6:** Relaunch the Dev plugin and run through all four row texts. Close and reopen the
      plugin: the override survives. Flip Figma's theme while overriding: the panel stays put.
- [x] **Step 7:** Commit `feat(plugin): dev builds can override the panel theme`.

## Implementation notes

- `theme-override.ts` sits in `src/`, not `src/main` or `src/ui`, because both threads import it.
  It names no `figma` global.
- If the stored value was unreadable, `parseThemeOverride` returns `null`, so a bad value is
  overwritten on the next click and never blocks start-up.
- The UI may draw one frame in Figma's theme before `ui-theme-override` arrives. That's acceptable,
  and only dev builds can see it.

## Dependencies

Phase 4 (`Theme`, `figma` state, the dark roles) and phase 5 (the 145 px window).

## Acceptance checks

- `bun test` passes, and both build checks in task 3 step 5 hold.
- Live: the dev panel matches the `Toggle=Body row` variants in both themes, and the override
  persists and ignores Figma's theme as required.
