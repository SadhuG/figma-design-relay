# Phase 2: Fonts and light styles

Back to [the overview](00-overview.md).

## Goal and scope

The stable panel looks like the light Rising sun screens: brand fonts, the overview's light colour
roles, and Rising sun chips, pill and buttons.

- **In:** `plugin/src/ui/fonts.css` (new), `plugin/src/ui/index.css`, `plugin/src/ui/main.tsx`,
  `UI_EXPANDED_HEIGHT` in `plugin/src/main/code.ts`, the two font packages.
- **Out:** icons (phase 3), dark values and following Figma (phase 4), anything dev-only.

## Requirements

- Fonts are inlined into `dist/index.html` as woff2 data URIs: four faces, nothing fetched at run
  time (the manifest allows only localhost).
- Font stacks: UI `"Zen Kaku Gothic New", system-ui, -apple-system, sans-serif`; mono
  `"M PLUS 1 Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Body text 11 px, line height 140 % (15.4 px); collapsed-bar chips 10 px.
- Every colour in `index.css` comes from a role variable named in the overview's colour table. The
  Board 10 variables (`--bg`, `--live`, `--working-bg`, …) are gone.
- Chips: radius 2 px, background `--surface-well`, no dot. Text colours: connecting
  `--text-secondary`, live `--status-connected`, lost `--status-error`, sent/syncing/diagram/leader
  `--text-primary`. Working: background `--surface-ink`, text `--text-on-ink`. Footer chips 18 px
  high (19 for the text-only connecting and live chips), collapsed 18 px.
- Dev pill: background `--sun-rising`, text `--text-on-sun`, M PLUS 1 Code 500 10 px, radius 2 px,
  18 px high.
- Buttons (Retry now, Show in canvas): transparent, 1 px `--line-horizon` border, `--text-primary`,
  radius 2 px, 17 px high. Select it: background `--surface-ink`, text `--text-on-ink`.
- Rows: label `--text-secondary`; value `--text-primary`; the Relay value in mono.
- Expanded window 121 px (rows 81 + spacer 4 + footer 36); collapsed stays 36.

## Tasks

### Task 1: Bundle the fonts

**Files:**

- Create: `plugin/src/ui/fonts.css`, `plugin/src/ui/styles.test.ts`
- Modify: `plugin/src/ui/main.tsx`, `plugin/package.json`, `plugin/bun.lock`

- [ ] **Step 1:** `cd plugin && bun add -d @fontsource/zen-kaku-gothic-new@5.3.1 @fontsource/m-plus-1-code@5.3.1`.
- [ ] **Step 2: Write the failing test** `styles.test.ts`, reading the CSS files as text:
      `fonts.css declares exactly four woff2 faces` (families and weights 400/500 each, every `src`
      a single `url(...latin-<weight>-normal.woff2) format("woff2")`, no `.woff"` fallback).
- [ ] **Step 3:** Run `cd plugin && bun test src/ui/styles.test.ts`. Expected: FAIL, `fonts.css`
      missing.
- [ ] **Step 4:** Write `fonts.css` with four `@font-face` rules, `font-display: block`, each
      pointing at `../../node_modules/@fontsource/<family>/files/<family>-latin-<weight>-normal.woff2`.
      Import it first in `main.tsx`. The package's own `latin-400.css` also lists a `.woff`
      fallback, which would double the bundle, so don't import it.
- [ ] **Step 5:** Run the test again. Expected: PASS.
- [ ] **Step 6:** `bun run build`, then check `dist/index.html`: `grep -c "data:font/woff2"`
      gives 4, and there is no `url(` to a `.woff2` file path. Note the file's size growth (about
      55 KB expected) for the PR.
- [ ] **Step 7:** Commit `feat(plugin): bundle the Rising sun panel fonts`.

### Task 2: Light roles and Rising sun styles

**Files:**

- Modify: `plugin/src/ui/index.css`, `plugin/src/ui/App.tsx` (dot removal only),
  `plugin/src/main/code.ts:2507-2508`

- [ ] **Step 1:** Extend `styles.test.ts` with three tests. "index.css uses only role
      variables": every `var(--…)` is one of the overview's 15 roles, `--font-ui` or
      `--font-mono`, with no hex or `rgba(` outside the `:root` block. ":root defines every light
      role with the overview's value". "every font stack ends in a system fallback": each
      `font-family` value ends in `sans-serif` or `monospace`. Run it. Expected: FAIL.
- [ ] **Step 2:** Rewrite `:root` with the 15 light roles plus `--font-ui` and `--font-mono`, and
      restyle `body`, `.rows`, `.row-*`, `.footer`, `.bar`, `.chip.*`, `.dev-pill`, `.button`,
      `.button.diagram`, `.version` and `.toggle` per the requirements. Focus rings stay
      `#0d99ff`: they are Figma's own, not the brand's.
- [ ] **Step 3:** In `App.tsx`, `Chip` renders no `.dot` for icon-less tones.
- [ ] **Step 4:** In `code.ts`, `UI_EXPANDED_HEIGHT = 121`, with the comment updated to "rows 81 + spacer 4 + footer 36".
- [ ] **Step 5:** Run `bun test` and `bun run build` in `plugin/`. Expected: all pass, zero type
      errors.
- [ ] **Step 6:** Relaunch the Dev plugin and compare it with `01 Stable · connected` (`80:96946`)
      and `03a One agent, named` (`81:97172`) side by side. Fix padding until rows, chip and footer
      line up with the screens.
- [ ] **Step 7:** Commit `feat(plugin): restyle the panel in the light Rising sun palette`.

## Implementation notes

- `vite-plugin-singlefile` raises Vite's asset inline limit, so a woff2 referenced from CSS is
  inlined. If step 6 of task 1 finds a file path instead, set `build.assetsInlineLimit` in
  `vite.config.ts` rather than base64-ing by hand.
- `.claude/rules/plugin.md` says the iframe has no Inter, so copy must fit the live panel rather
  than the board. With the brand fonts bundled, the board's measurements hold for Latin text.
  Phase 7 rewrites that rule.

## Dependencies

Phase 1, for the final screens.

## Acceptance checks

- `bun test` and `bun run build` pass in `plugin/`, with 4 woff2 data URIs in `dist/index.html`.
- The Dev plugin, side by side with the light screens, matches in fonts, colours, chip shapes and
  the 121 px height, for the connected, working, lost and connecting states.
