---
paths:
  - "CHANGELOG.md"
  - "**/package.json"
  - ".github/**"
  - "scripts/**"
---

# Release and CI rules

## Versions

- Server and plugin always carry the same version. `CHANGELOG.md` (Keep a Changelog) gets a
  `## [x.y.z] - YYYY-MM-DD` entry in the same commit as the bump. `bun scripts/check-version.mjs`
  fails otherwise, and CI runs it on every push.
- **A finished phase bumps the minor; a fix, hardening or tooling change bumps the patch;
  docs-only commits do not bump.** Done without being asked, in the task's last commit.
- `0.2.0`–`0.5.0` were assigned after the fact: their tags mark where each phase finished, but the
  `package.json` in those commits says `0.1.1`. `0.5.1` is the first where they agree.

## Publishing

- **Nothing goes to npm.** `@gethopp` is upstream's scope, so `server/package.json` is
  `figma-design-relay-server` with `"private": true`. Do not rename it back.
- **Every push to `main` with a new version publishes it.** `.github/workflows/release.yml` runs
  on each push to `main`, reads the version via `check-version.mjs`, uses its changelog entry as
  the notes, tags the pushed commit `vX.Y.Z` and creates the release. A version that already has
  a release (a docs-only merge) builds and stops; a tag that exists on another commit fails the
  run. So bump in the task's last commit, and the user's `dev` → `main` merge ships it.
- **Nobody tags by hand.** If a tag must be pushed, push it by name (`git push origin vX.Y.Z`).
  **Never `git push --tags`** — the local clone holds upstream's `v0.0.x` tags, which do not
  belong on this fork's remote.
- A manual run (`workflow_dispatch`) has `dry_run`, **default true**, and publishes only from
  `main`; on any other branch it builds and uploads the archive as an artifact with no tag or
  release, even with `dry_run` off. Dry-run the branch whenever the workflow or the archive changes.
- **`gh` must target the fork.** A clone with the `upstream` remote can resolve `gh` to
  `gethopp/figma-mcp-bridge` (a dispatch then fails with "Must have admin rights"). Run
  `gh repo set-default SadhuG/figma-design-relay` once per clone before any `gh workflow`,
  `gh release` or `gh pr` command.
- A release only becomes **Latest** when its version is newer than the current latest one, so a
  re-run of an older version cannot move `releases/latest/download/…` backwards.
- `scripts/package-release.mjs` decides what ships and refuses a dev-slot build, a plugin that
  dials anything but 1994, a server without its shebang, missing runtime or present dev
  dependencies. The asset is always `figma-design-relay.zip` (plus `SHA256SUMS.txt`), so
  `releases/latest/download/figma-design-relay.zip` is permanent. It unpacks to one unversioned
  `figma-design-relay/` folder: `plugin/` (stable `manifest.json` + `dist/`), `server/` (`dist/`,
  `dashboard/` beside it, `package.json`, `bun.lock` and production `node_modules/`, so the user
  needs Node ≥ 20 and no Bun), `VERSION`, `README.md`, `CHANGELOG.md`, `LICENSE.md`. README's
  Quick Start documents that layout — keep them in step.

## CI

- `ci.yml` runs the version check, the plugin type-check, both test suites and both builds on
  **every push to every branch** and on pull requests. Branch pushes validate work early;
  upstream merges are resolved on a feature branch, then land through reviewed PRs into `dev`
  and separately into `main`. CLAUDE.md's PR review and checks gate applies to both promotions.
- Every action runs on **node24**. When adding one, check `action.yml`'s `runs.using` at the exact
  ref you pin — a high major version does not imply a current runtime
  (`softprops/action-gh-release@v2` was still node20 after v3 shipped).
