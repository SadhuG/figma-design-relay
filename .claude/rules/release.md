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
- After merging onto `main`, tag that commit `vX.Y.Z` and push it by name
  (`git push origin vX.Y.Z`). **Never `git push --tags`** — the local clone holds upstream's
  `v0.0.x` tags, which do not belong on this fork's remote.
- `.github/workflows/release.yml` is `workflow_dispatch` with one input, `dry_run`, **default
  true**. It reads the version via `check-version.mjs` and uses the changelog entry as the notes,
  so bump first. A dry run builds and uploads the archive as an artifact with no tag or release;
  use one whenever the workflow changes.
- The archive carries `plugin/` (self-contained) and `server/` (`dist` + `package.json` +
  `bun.lock`; the user runs `bun install --production`). README's Quick Start documents that flow —
  keep them in step.

## CI

- `ci.yml` runs the version check, the plugin type-check, both test suites and both builds on
  **every push to every branch** and on pull requests. Every branch, because upstream merges are
  resolved on a feature branch and merged onto `dev` without a PR — after a separate agent's
  review (`finish-task` step 4), never before.
- Every action runs on **node24**. When adding one, check `action.yml`'s `runs.using` at the exact
  ref you pin — a high major version does not imply a current runtime
  (`softprops/action-gh-release@v2` was still node20 after v3 shipped).
