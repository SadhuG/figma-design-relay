# Panel theme: live check

Back to [the overview](00-overview.md).

**Candidates:** `be23b3d` (0.11.0) on `feat/panel-theme` for sections 1 and 2. Section 3 re-checks
the override on `745ab92`, the only code change since: CodeRabbit's fix that stores quick clicks
in order (`createThemeOverrideSaver`). It touches nothing but the override's saving.

**Setup (2026-10-23):** Figma desktop on Windows 11. The dev build ran as **Figma Design Relay (Dev:
panel-theme, port 1995)**, imported from the worktree's `plugin/dist/manifest.json`, against the
worktree's relay (`server/dist/index.js`, leader on 1995). The stable build was the same commit
built with `.dev-slot.json` moved aside, copied into a scratch folder with `plugin/manifest.json`,
imported temporarily, and checked against the stable relay on 1994. Afterwards the main checkout's
`plugin/manifest.json` was imported again and ran as v0.10.1.

## 1. Theme, editors and builds

Steps 1–5 were checked by the user, by eye. Steps 6–9 were run by a Codex agent with computer use,
which saved the screenshots. Calls went through `server/.smoke/call.mjs`, which joins the leader
as a follower.

| #   | Case                                                                                                                                              | Result |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0   | `list_files`, `get_metadata`, and a node-addressed `get_node` (`97:868`) through the follower hop, design file "Figma Design Relay"               | pass   |
| 1   | Dev panel opens expanded at 145 px: four rows with the Theme row `… · Figma` matching Figma's theme; footer not clipped                           | pass   |
| 2   | Collapse and expand: bar and open view both whole                                                                                                 | pass   |
| 3   | Figma's theme flipped both ways with the panel open: it recolours at once and the Theme text follows                                              | pass   |
| 4   | Switch → `… · override`; Figma's theme flipped while overriding: the panel stays; clicking back lands on `· Figma`                                | pass   |
| 5   | Override set, plugin closed and run again: still overriding                                                                                       | pass   |
| 6   | FigJam: `get_metadata` through the plugin; panel stays light under Figma's Dark preference (see below)                                            | pass   |
| 7   | Slides: `get_metadata` through the plugin; `Light · Figma` cream → `Dark · Figma` near-black, live; footer whole                                  | pass   |
| 8   | A design file named `デザイン`: the File row shows it readably in the system fallback font, no boxes                                              | pass   |
| 9   | Stable build: File, Selection and Relay only (no Theme row), `ws://localhost:1994`, `v0.11.0`, footer whole; follows Figma's theme live both ways | pass   |

**FigJam stays light, and that is right.** FigJam has no dark UI and no theme preference: with
Figma set to Dark, its canvas, toolbars and top bar stay light (`live-check/06-figjam-dark.png`), so
Figma gives the plugin `figma-light`. The panel follows its editor, as in Slides and design files.
The agent first marked this as a fail against the brief's "dark in FigJam" expectation; the brief
was wrong, not the panel.

**Seen, not a defect:** Figma truncates the Dev window's title ("Figma Design Relay (Dev:
panel-the…") at 320 px. That bar is Figma's own chrome, and a Dev name must carry its port.

Screenshots: [`live-check/`](live-check/): FigJam dark, Slides light and dark, the Japanese file
name, stable dark and light.

## 2. Every panel state, both themes

Run by the Codex agent on the `be23b3d` build (worktree head `160d88a`, docs only after it), Dev
plugin in the design file "Figma Design Relay", Theme row on `· Figma`. Each state was raised for
real: the relay stopped (lost), the plugin relaunched with no relay (connecting), an 8 s
`run_script` (working), `get_document` on the page "Shortlist directions" (syncing), `get_selection`
with one layer selected (sent), a second relay process as follower (leader), and `generate_diagram`
in a scratch FigJam board (diagram, FigJam is light only). Nothing was clipped in any capture.

| State      | Text seen                                                                           | Light | Dark |
| ---------- | ----------------------------------------------------------------------------------- | ----- | ---- |
| lost       | `Relay lost · retry in N s`, Moved glyph, red; `(no answer)`; outlined Retry now    | pass  | pass |
| connecting | `Connecting…`, secondary text                                                       | pass  | pass |
| live       | `Live on port 1995`, green                                                          | pass  | pass |
| working    | `tool-smoke is working`, ink chip, pixel cursor                                     | pass  | pass |
| syncing    | `Reading the layer tree… NN%`, outline-stack glyph                                  | pass  | pass |
| sent       | `Sent to your agent`, selection glyph; row `1 node · sent just now`; Show in canvas | pass  | pass |
| leader     | `Leader · 1 follower`, darts glyph                                                  | pass  | pass |
| diagram    | `Diagram drawn on this page`, shapes glyph; filled Select it                        | pass  | —    |

During syncing the Dev pill shortens to `Dev: panel-the…`: it gives way so the state stays
readable (`.dev-pill`'s `flex-shrink: 100`), as designed. The agent's brief expected the sent row as
`1 · sent just now`; the shipped text, `1 node · sent just now`, is `selectionRowText`'s, so that
was the brief's error.

## 3. The override on `745ab92`

After CodeRabbit's fix, the Dev plugin was rebuilt from `745ab92`, closed and run again, and checked
by the Codex agent in the design file "Figma Design Relay" (Figma on Dark):

| Case                                                            | Before → after relaunch                   | Result |
| --------------------------------------------------------------- | ----------------------------------------- | ------ |
| `list_files`, then `get_node` `97:868` through the follower hop | "Theme toggle"; chip back to Live on 1995 | pass   |
| One click                                                       | `Light · override` → `Light · override`   | pass   |
| Three clicks in ~400 ms (override → Figma → override)           | `Light · override` → `Light · override`   | pass   |
| Two clicks in ~250 ms                                           | `Light · override` → `Light · override`   | pass   |
| Clicked back to Figma                                           | `Dark · Figma` → `Dark · Figma`           | pass   |
| Figma flipped Dark → Light → Dark while overriding              | panel stayed `Light · override`           | pass   |

The agent left the row on `· Figma` and Figma on Dark.

Screenshots for sections 2 and 3 are in [`live-check/`](live-check/) too, named by state and theme.
