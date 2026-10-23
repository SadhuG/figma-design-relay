# Panel theme: overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Load this file
> plus the one phase file you are working on, not the whole folder. Steps use checkbox (`- [ ]`)
> syntax for tracking.

## Project

**Goal:** Restyle the plugin panel in the Rising sun brand, fonts included. The panel follows
Figma's light or dark theme in every build, and a dev build also gets a Theme row that can override
it for testing designs.

**Design source (the spec):** Figma file "Figma Design Relay", page **Plugin UI screens**
(`80:96903`). The light screens are in sections Connection `81:97657`, Agents working `81:97658`,
Activity `81:97659` and Toggle `81:97660`, and the dark screens in **Plugin UI screens (Dark)**
`84:99390`. The theme row is in section **Theme toggle** `97:868`, `Plugin panel` variants
`Toggle=Body row` (`97:916` light, `97:963` dark). Where this plan and the screens disagree, the
screens win and the plan gets fixed. The decisions below were made with the user on 2026-10-22 and
2026-10-23.

**Context:** The panel is React in the plugin iframe (`plugin/src/ui/`). `App.tsx` wires up pure
rules from `panel-state.ts`; `index.css` styles it with the old Board 10 palette ("Light only for
now"). The main thread (`plugin/src/main/code.ts:2506`) sizes the window, stores `ui-collapsed` in
`figma.clientStorage` and opens the UI hidden until that resolves. A dev build differs from stable
only at build time: `uiDefine` (`plugin/dev-slot.ts:116`) bakes `VITE_FIGMA_DESIGN_RELAY_SLOT` into
the UI build. The main build gets no defines today.

**Tech stack:** React 18, Vite 5 with `vite-plugin-singlefile`, TypeScript, `bun test`. Fonts come
from `@fontsource/zen-kaku-gothic-new` and `@fontsource/m-plus-1-code` (5.3.1, OFL-1.1).

**Worktree:** `../figma-design-relay-panel-theme`, branch `feat/panel-theme` (from `origin/main` at
`a2c8758`), dev slot `panel-theme` on port **1995**. In Figma it runs as **Figma Design Relay (Dev:
panel-theme, port 1995)**.

## Decisions

| Topic            | Decision                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palette          | Rising sun, light and dark, in every build. The stable panel's look changes from white Board 10 to cream Rising sun.                                                                                                                                                                                                                                                       |
| Fonts            | Bundled, Latin subset, woff2 only: Zen Kaku Gothic New 400 and 500 (UI text), M PLUS 1 Code 400 and 500 (relay address, version, Dev pill). Text is 11 px (chips in the collapsed bar 10 px) with a 140 % line height, rounded to the 15 px rows the screens draw (15.4 px would make the open panel 82.2 px of rows, not 81). Other scripts fall back to the system font. |
| Icons            | Rising sun's: the `App icon` set (Channel Stable/Dev × State Live/Offline) and the `Icon` set (`71:93456`, Brand kit page). The chip icons are Pixel cursor (working), Moved (lost), Selection out (sent), Outline stack (syncing), Shape relay (diagram), Darts (leader) and Chevron up/down.                                                                             |
| Following Figma  | `figma.showUI(…, { themeColors: true })`. Figma puts `figma-light` or `figma-dark` on the iframe's `<html>` and changes it live. Only the class is used, not Figma's colour variables.                                                                                                                                                                                     |
| Override         | **Dev builds only**, gated on `VITE_FIGMA_DESIGN_RELAY_SLOT`, so the stable build never shows or applies it, and its main thread never reads, stores or posts one. Three states: follow Figma (default), light, dark.                                                                                                                                                      |
| Override UI      | A **Theme** row under Relay: the switch shows the theme in effect, with the text `Light · Figma` / `Dark · Figma` while following, `Light · override` / `Dark · override` while overriding. Clicking flips the theme; if that lands on Figma's theme, the override clears. There is no Reset link.                                                                         |
| Override storage | `figma.clientStorage` key `theme-override`, read and written by the main thread like `ui-collapsed`. Each dev plugin id has its own storage, so an override never reaches stable.                                                                                                                                                                                          |
| CSS switching    | Light colours on `:root`; dark on `:root.figma-dark:not([data-theme="light"]), :root[data-theme="dark"]`. The override only sets or removes `data-theme` on `<html>`.                                                                                                                                                                                                      |
| Window height    | Fixed per build, chosen at build time: a `mainDefine(slot)` beside `uiDefine` gives the main build the slot. Expanded **121** stable (Rising sun rows are 15 px) and **145** dev (Theme row 18 px plus a 6 px gap); collapsed 36 in both. Confirmed against the live panel in phase 7.                                                                                     |
| Review gate      | Per CLAUDE.md: live Figma checks, an independent GPT-6.1-Sol review, PR → `dev`, then the `dev` → `main` PR left for the user.                                                                                                                                                                                                                                             |

## Colour roles

CSS custom properties are named after the Figma roles (`surface/paper` → `--surface-paper`).
Values are as resolved in the screens on 2026-10-23.

| Role               | Light     | Dark      | Used for                                                   |
| ------------------ | --------- | --------- | ---------------------------------------------------------- |
| `surface/paper`    | `#f7f4ee` | `#121110` | panel background                                           |
| `surface/well`     | `#ede7db` | `#1c1a17` | chip background, switch track                              |
| `surface/raised`   | `#ffffff` | `#24211d` | switch knob                                                |
| `surface/ink`      | `#1a1a1a` | `#f7f4ee` | working chip, Select it button, Dev app-icon tile          |
| `text/primary`     | `#1a1a1a` | `#f7f4ee` | row values, sent/syncing/diagram/leader chip text, buttons |
| `text/secondary`   | `#635c4e` | `#a39c8f` | row labels, connecting chip, version, collapse chevron     |
| `text/on-ink`      | `#f7f4ee` | `#1a1a1a` | text on `surface/ink`                                      |
| `text/on-sun`      | `#f7f4ee` | `#f7f4ee` | Dev pill text                                              |
| `sun/rising`       | `#bc002d` | `#d0103a` | live sun in the app icon, Dev pill, light switch glyph     |
| `sun/set`          | `#7a7364` | `#8a8376` | offline sun in the app icon                                |
| `sun/on-ink`       | `#f7f4ee` | `#1a1a1a` | sun on the Dev app-icon tile                               |
| `line/hairline`    | `#dcd4c4` | `#38342e` | footer divider, switch track outline                       |
| `line/horizon`     | `#1a1a1a` | `#f7f4ee` | app-icon horizon, outlined button border                   |
| `status/connected` | `#446c33` | `#82ad66` | live chip text                                             |
| `status/error`     | `#bc002d` | `#e8475f` | lost chip text                                             |

## Global constraints

- Bun only (`bun add -d`, `bun test`, `bun run`), never npm or yarn. Everything LF; `bun run format`
  from the root before committing.
- `plugin`: `bun run typecheck` stays at zero errors; imports are extensionless; new modules don't
  name the `figma` global (`.claude/rules/plugin.md`).
- New behaviour is test-first: failing test, see it fail, implement, see it pass, commit.
- Never edit `plugin/manifest.json` for this: `themeColors` is a `showUI` option, not a manifest
  field.
- A dev plugin's name always carries its port; this plan doesn't touch `devManifest`.
- Commits `feat(plugin): …`, `test: …`, `docs: …`. Versions are bumped by `finish-task` in phase 7,
  not per phase.

## Review focus

The cases the tasks' own tests don't reach that are most likely to bite. Each has its test in the
task named.

1. **A file name in Japanese, Cyrillic or emoji** renders in the system font, never as boxes:
   every font stack ends in a system fallback (phase 2, task 1 test; phase 7 live case).
2. **Changing Figma's theme while the panel is open** recolours it at once, without a relaunch
   (phase 4, task 2 test of `watchFigmaTheme`; phase 7 live case).
3. **A stored `theme-override` that isn't `"light"` or `"dark"`** (an older build, a bad write) is
   treated as "follow Figma" (phase 6, task 1 test).
4. **The stable build carries no override:** its `dist/` has no `· override` text and opens at 121
   (phase 5 task 1 and phase 6 task 3 build checks).
5. **FigJam and Slides** follow Figma's theme the same way design files do (phase 7 live case).

## Phases

| #   | Phase                                           | Summary                                                                                                                                                  | Status      |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | [Figma design](01-figma-design.md)              | Finish the spec in Figma: the body-row variants become the dev panel (Dev pill, Dev icon, final row text); the footer variants are marked as not chosen. | done        |
| 2   | [Fonts and light styles](02-fonts-and-light.md) | Bundle the four woff2 faces, replace the Board 10 palette with the light Rising sun roles, restyle chips, buttons and pill; stable height 113 → 121.     | done        |
| 3   | [Icons](03-icons.md)                            | Swap `icons.tsx` for the Rising sun app icon and glyphs, coloured through the role variables.                                                            | done        |
| 4   | [Follow Figma's theme](04-follow-figma.md)      | `themeColors: true`, the dark role values, and `theme.ts`'s rules for reading Figma's theme.                                                             | done        |
| 5   | [Dev build height](05-dev-height.md)            | `mainDefine` plus `panel-size.ts`: the main build learns it is a dev build and opens at 145.                                                             | done        |
| 6   | [Dev theme override](06-dev-override.md)        | The `theme-override` storage and messages, the override rules, and the Theme row in dev builds.                                                          | done        |
| 7   | [Ship](07-ship.md)                              | Live check in both builds and both Figma themes, docs and rules, then `finish-task`.                                                                     | in progress |

Phases 2–4 change the stable panel; 5 and 6 only the dev build. Phase 5 does not depend on 2–4 and
can run any time before 6.

**Out of scope:** a theme setting in the stable build; using Figma's own `--figma-color-*`
variables; Japanese or other non-Latin subsets of the brand fonts; restyling Figma's window title
bar, which Figma draws.
