# Phase 4: Follow Figma's theme

Back to [the overview](00-overview.md).

## Goal and scope

Every build shows the dark Rising sun panel when Figma is dark and the light one when it is light,
and switches live when the user changes Figma's theme.

- **In:** `plugin/src/ui/theme.ts` (new), the dark block in `index.css`, `themeColors` in
  `code.ts`, a theme hook in `App.tsx`.
- **Out:** any override (phase 6).

## Requirements

- `figma.showUI(__html__, { …, themeColors: true })`.
- The dark values are the overview's colour table, on
  `:root.figma-dark:not([data-theme="light"]), :root[data-theme="dark"]`.
- With no `figma-dark` or `figma-light` class (a browser preview, an old Figma), the panel is
  light.
- `App` knows Figma's current theme as state. Phase 6 needs it for the row text.

## Tasks

### Task 1: Read Figma's theme

**Files:**

- Create: `plugin/src/ui/theme.ts`, `plugin/src/ui/theme.test.ts`

**Interfaces:**

- Produces: `type Theme = "light" | "dark"`; `figmaTheme(className: string): Theme`;
  `watchFigmaTheme(root: HTMLElement, onChange: (theme: Theme) => void): () => void`, which calls
  `onChange` with the current theme at once and again on each change, and returns an unsubscribe.

- [x] **Step 1: Write the failing tests:** `figmaTheme("figma-dark") === "dark"`,
      `figmaTheme("figma-light") === "light"`, `figmaTheme("") === "light"`,
      `figmaTheme("foo figma-dark bar") === "dark"`, `figmaTheme("figma-darker") === "light"`
      (a whole class only).
- [x] **Step 2:** Run `cd plugin && bun test src/ui/theme.test.ts`. Expected: FAIL, module
      missing.
- [x] **Step 3:** Implement `figmaTheme` by splitting on whitespace.
- [x] **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit `feat(plugin): read Figma's theme from the iframe class`.

### Task 2: Watch it and apply the dark roles

**Files:**

- Modify: `plugin/src/ui/theme.ts`, `plugin/src/ui/theme.test.ts`, `plugin/src/ui/index.css`,
  `plugin/src/ui/styles.test.ts`, `plugin/src/ui/App.tsx`, `plugin/src/main/code.ts:2525`

- [x] **Step 1: Write the failing tests.** `watchFigmaTheme` takes the `MutationObserver`
      constructor as an optional third parameter so Bun can pass a fake: "reports the current
      theme at once", "reports a class change" (the fake fires its callback after `className`
      changes), "stops after unsubscribe". In `styles.test.ts`: "the dark block defines every role
      with the overview's dark value" and "the dark selector is exactly the overview's".
- [x] **Step 2:** Run both test files. Expected: FAIL.
- [x] **Step 3:** Implement `watchFigmaTheme`, observing `attributeFilter: ["class"]` only. Add
      the dark block to `index.css`.
- [x] **Step 4:** In `App.tsx`, add `const [figma, setFigma] = useState<Theme>("light")` and a
      `useEffect` that subscribes with `watchFigmaTheme(document.documentElement, setFigma)`.
- [x] **Step 5:** In `code.ts`, add `themeColors: true` to the `showUI` options.
- [x] **Step 6:** Run `bun test` and `bun run build` in `plugin/`. Expected: PASS, zero type
      errors.
- [x] **Step 7:** Relaunch the Dev plugin. Switch Figma's theme (Figma menu → Theme) and check
      that the panel matches `01 Stable · connected`'s dark twin in `84:99390` without a relaunch.
- [x] **Step 8:** Commit `feat(plugin): follow Figma's light or dark theme`.

## Implementation notes

- The iframe's `<html>` belongs to the panel, but Figma rewrites its `class`. The override in
  phase 6 therefore uses `data-theme`, never the class.
- `figma` (the state) isn't used to pick colours, which CSS does on its own. It exists for phase 6's
  text and for tests.

## Dependencies

Phase 2: the role variables and their light values.

## Acceptance checks

- `bun test` passes; `dist/code.js` contains `themeColors: true`.
- Live: flipping Figma's theme recolours the open panel both ways, collapsed and expanded.
