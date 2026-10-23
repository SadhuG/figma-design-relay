# Phase 2: Release workflow

[← Overview](00-overview.md)

## Goal and scope

`release.yml` publishes a release by itself whenever a new version lands on `main`.

- **In:** triggers, the already-released skip, the main-only guard, zip + checksums, the release
  step, the run summary.
- **Out:** what goes in the archive (phase 1 owns it); backfilling releases for `0.9.0`–`0.11.0`
  (not wanted: `0.11.1` is the first published release).

## Requirements

- `on: push: branches: [main]` and `workflow_dispatch` with `dry_run` (boolean, default `true`).
- `concurrency: { group: release, cancel-in-progress: false }` — two quick merges must not cancel a
  half-published release.
- **Publish** only when all hold: ref is `refs/heads/main`; the event is `push`, or `dispatch` with
  `dry_run: false`; no GitHub Release named `v<version>` exists. Otherwise build and upload the
  artifact only, and say why in the step summary (`already released`, `dry run`, `not main`).
- If tag `v<version>` already exists and does not point at `github.sha`, **fail** before publishing:
  `ERROR: tag v<version> points at <sha>, not this commit — bump the version or delete the stray tag.`
  (`action-gh-release` would otherwise attach the release to the old commit.)
- Assets: `figma-design-relay.zip` (zip of the staged `figma-design-relay/` folder) and
  `SHA256SUMS.txt` (`sha256sum figma-design-relay.zip`).
- Release: `tag_name: v<version>`, `target_commitish: ${{ github.sha }}`,
  `name: Figma Design Relay v<version>`, `make_latest: true`, body = the changelog entry followed by
  `\n\n---\nDownload **figma-design-relay.zip** below. Setup and updating: [README → Quick Start](https://github.com/SadhuG/figma-design-relay#quick-start).`
- Every action stays on node24 (`.claude/rules/release.md`).

## Tasks

### Task 1: Rewrite `release.yml`

**Files:**

- Modify: `.github/workflows/release.yml` (whole file; keep its header comment's npm reasoning,
  rewrite the trigger paragraph)

**Interfaces:**

- Consumes: phase 1's CLI `bun scripts/package-release.mjs <outDir>` → `<outDir>/figma-design-relay`;
  `bun scripts/check-version.mjs` and `--notes`.
- Produces: step `decide` with outputs `version`, `publish` (`true`/`false`), `reason`.

- [ ] **Step 1: Write the `decide` step**

  Shell, with `GH_TOKEN: ${{ github.token }}`: version from `check-version.mjs`;
  `gh release view "v$version"` succeeding means released; `git ls-remote --tags origin "v$version"`
  gives the tag's sha for the stray-tag check (checkout with `fetch-depth: 0` is not needed).

- [ ] **Step 2: Replace the build/package steps**

  Server install + build, plugin install + build (as today, minus the shebang check, now in phase 1's
  `checkStaged`), then `bun scripts/package-release.mjs release`, then
  `(cd release && zip -qr ../figma-design-relay.zip figma-design-relay)` and the checksum. Upload both
  files as artifact `figma-design-relay-v<version>` on every run.

- [ ] **Step 3: Gate the release step on `steps.decide.outputs.publish == 'true'`** and write the
      summary from `reason`.

- [ ] **Step 4: Format and commit**

  Run: `bun run format` then `bun run format:check`
  Expected: `All matched files use Prettier code style!`

  ```bash
  git add .github/workflows/release.yml
  git commit -m "feat(release): publish a release for every new version on main"
  ```

- [ ] **Step 5: Push the branch and dry-run it**

  Run: `git push -u origin fix/releases` then
  `gh workflow run release.yml --ref fix/releases -f dry_run=false` (deliberately not a dry run:
  this proves the main-only guard), then `gh run watch`.
  Expected: success; summary says `not main`; `gh release list` is still empty; artifact holds
  `figma-design-relay.zip` and `SHA256SUMS.txt`.

- [ ] **Step 6: Inspect the artifact**

  Run: `gh run download <run-id> -D .release-test/ci` then
  `unzip -l .release-test/ci/*/figma-design-relay.zip | head -40` and
  `cd .release-test/ci/* && sha256sum -c SHA256SUMS.txt`
  Expected: every path starts `figma-design-relay/`; `server/node_modules/ws/` is present,
  `typescript` is absent; checksum `OK`.

## Dependencies

Phase 1 (`scripts/package-release.mjs`).

## Acceptance checks

- Dry run on `fix/releases` succeeds without creating a tag or release (`gh release list` still empty).
- The workflow, read top to bottom, can only publish from `main`.
