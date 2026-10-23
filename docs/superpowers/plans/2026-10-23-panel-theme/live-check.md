# Panel theme: live check

Back to [the overview](00-overview.md).

**Candidate:** `be23b3d` (0.11.0) on `feat/panel-theme`, approved by GPT-6.1-Sol review round 2. No
code changed after it; this file and its screenshots are the only additions.

**Setup (2026-10-23):** Figma desktop on Windows 11. The dev build ran as **Figma Design Relay (Dev:
panel-theme, port 1995)**, imported from the worktree's `plugin/dist/manifest.json`, against the
worktree's relay (`server/dist/index.js`, leader on 1995). The stable build was the same commit
built with `.dev-slot.json` moved aside, copied into a scratch folder with `plugin/manifest.json`,
imported temporarily, and checked against the stable relay on 1994. Afterwards the main checkout's
`plugin/manifest.json` was imported again and ran as v0.10.1.

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
