# Phase 4: Docs, bump and ship

[← Overview](00-overview.md)

## Goal and scope

Make the repo's own rules describe the new release flow, bump to 0.11.1, prove the archive works in
Figma, and land it through the normal gate. Merging the `dev` → `main` PR publishes 0.11.1.

- **In:** `.claude/rules/release.md`, `.claude/skills/finish-task/SKILL.md` step 5, `CLAUDE.md`
  (scripts list, root `bun test ./scripts` command), `docs/superpowers/README.md` plan entry,
  `CHANGELOG.md`, both `package.json` versions, live check record.
- **Out:** in-plugin update notifications (possible follow-up: the panel could compare `VERSION`
  with the latest release; not planned).

## Requirements

- `release.md` _Publishing_: the workflow tags and releases on every push to `main` with a new
  version; nobody tags by hand; `git push --tags` stays forbidden; the archive layout and the
  fixed asset name; a dry run on any workflow change.
- `finish-task` step 5: replace "tag the merged `origin/main` commit and push that tag" with "the
  Release workflow tags and publishes when the `dev` → `main` PR merges; check its run with
  `gh run list --workflow release.yml --limit 1`, and that `gh release view v<version>` lists
  `figma-design-relay.zip`."
- `CHANGELOG.md` `## [0.11.1] - <date>` under _Changed_: releases publish on every version merged to
  `main`; the archive runs with Node alone; README setup rewritten.

## Tasks

### Task 1: Rules, changelog, bump

**Files:**

- Modify: `.claude/rules/release.md`, `.claude/skills/finish-task/SKILL.md`, `CLAUDE.md`,
  `docs/superpowers/README.md`, `CHANGELOG.md`, `server/package.json`, `plugin/package.json`

- [ ] **Step 1: Edit the files per the requirements.** In `CLAUDE.md`'s Commands table add
      `bun test ./scripts` (root) and `bun scripts/package-release.mjs <dir>`; in Layout's
      `scripts/` line add `package-release.mjs`.
- [ ] **Step 2: Verify**

  Run: `bun scripts/check-version.mjs && bun run check`
  Expected: prints `0.11.1`; all tests, builds and format pass.

- [ ] **Step 3: Commit**

  ```bash
  git commit -am "chore(release): 0.11.1 — publish a downloadable release for every version"
  ```

### Task 2: Live check of the archive

The archive's plugin has the stable id and dials 1994, so this check briefly stands in for the
stable install. **Ask the user before starting**; they quit MCP clients using the stable relay.

- [ ] **Step 1: Dry-run the final head** (`gh workflow run release.yml --ref fix/releases -f dry_run=true`)
      and download its artifact into `.release-test/live/`; unzip it there.
- [ ] **Step 2: Start the archived server with plain Node** —
      `node .release-test/live/figma-design-relay/server/dist/index.js` from a shell with no Bun on
      `PATH` for that command. Expected: it becomes leader on 1994; `http://127.0.0.1:1994/` loads.
- [ ] **Step 3: In the Figma desktop app**, import `.release-test/live/figma-design-relay/plugin/manifest.json`,
      run it in a design file and in a FigJam board. Expected: chip **Live** in both.
- [ ] **Step 4: Call tools** with `server/.smoke/call.mjs` against 1994: `list_files`, `get_selection`,
      and one node-addressed tool through a second (follower) server process. Expected: real results.
- [ ] **Step 5: Restore** the stable relay, re-import the main checkout's `plugin/manifest.json`, and
      record commit, run id, setup, cases and results in
      `docs/superpowers/plans/2026-10-24-release-downloads/live-check.md`; commit it.

### Task 3: Land it

- [ ] **Step 1: Run the `finish-task` skill** — GPT-6.1-Sol review rounds, PR → `dev`, then the
      `dev` → `main` PR left for the user, both carrying the dry-run run id and live-check record.
- [ ] **Step 2: After the user merges to `main`**: `gh run watch` the Release run, then
      `curl -sIL https://github.com/SadhuG/figma-design-relay/releases/latest/download/figma-design-relay.zip | grep -i "^http"`
      Expected: final `HTTP/2 200`; `gh release view v0.11.1` lists both assets.
- [ ] **Step 3: Mark every phase done in the overview** and tear down the dev slot (`start-feature` step 4).

## Dependencies

Phases 1–3.

## Acceptance checks

- `gh release list` shows `Figma Design Relay v0.11.1` as Latest with `figma-design-relay.zip` and
  `SHA256SUMS.txt`.
- The README's download link downloads that zip.
- A later docs-only merge to `main` produces a Release run whose summary says `already released`.
