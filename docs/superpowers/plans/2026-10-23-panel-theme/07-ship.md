# Phase 7: Ship

Back to [the overview](00-overview.md).

## Goal and scope

Prove the candidate in real Figma, bring the docs and rules up to date, and land it through
`finish-task`.

- **In:** the live check record, `.claude/rules/plugin.md`, `.claude/CLAUDE.md` facts,
  `docs/superpowers/README.md`, the CHANGELOG and version (through `finish-task`).
- **Out:** new behaviour. A live failure goes back to the phase that owns it.

## Requirements

- Live checks follow the `live-figma-check` skill, on the exact candidate commit, recorded in
  `live-check.md` beside this file and in the PR.
- Both builds are checked: stable as built with the slot file moved aside, loaded via
  `plugin/manifest.json` from the worktree, and dev as the Dev plugin.

## Tasks

- [x] **Step 1:** Run the full suite: `bun run format:check` at the root, then
      `bun run build && bun test` in `server/` and in `plugin/`. Expected: all pass.
- [x] **Step 2:** Live, dev build, design file: in each Figma theme, check the connecting,
      connected, working, lost and syncing states against the screens; the four Theme row texts;
      the override surviving a relaunch; and the override ignoring a Figma theme change. Also make
      one follower call through a second relay process, so the leader state shows.
- [x] **Step 3:** Live, dev build: the same theme flip in a FigJam board and a Slides deck.
- [x] **Step 4:** Live: a file named in Japanese (for example `デザイン`) shows its name in the
      system font with no boxes.
- [x] **Step 5:** Live, stable build: no Theme row, opens at 121, follows Figma's theme both ways.
- [x] **Step 6:** Measure the live expanded panels. If they aren't 121 and 145, fix
      `panel-size.ts` and its test, and correct the overview's Window height decision.
- [x] **Step 7:** Write `live-check.md`: the commit tested, the setup, each case and its result.
- [x] **Step 8:** Update `.claude/rules/plugin.md`. The "no Inter" constraint now says the panel
      bundles its fonts (Latin only), and the design source is the Rising sun Plugin UI screens
      page, no longer Board 10. Add a constraint for `themeColors` and `data-theme`, and update the
      `code.ts:2506` landmark for `panel-size.ts` and `theme-override`.
- [x] **Step 9:** Add this plan to `docs/superpowers/README.md`'s plan list, and mark phases 1–7
      done in the overview.
- [ ] **Step 10:** Run `finish-task`. It refreshes the CLAUDE.md facts (test counts, layout gains
      `theme-override.ts`, `panel-size.ts` and `theme.ts`), bumps the minor version with a
      CHANGELOG entry, gets the GPT-6.1-Sol review and opens the PRs.

## Dependencies

Phases 1–6.

## Acceptance checks

- `live-check.md` records every case above as passing on the commit the PR's head carries.
- The feature → `dev` PR is merged through GitHub after review, and the `dev` → `main` PR is open
  for the user.
