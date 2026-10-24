# Release downloads: overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Load this file
> plus the one phase file you are working on, not the whole folder. Steps use checkbox (`- [ ]`)
> syntax for tracking.

## Project

**Goal:** Every version that reaches `main` publishes a GitHub Release with one downloadable archive
that runs with nothing but Node, and the README tells a user how to download, set up and update it.

**Context (found 2026-10-24):**

- The fork has **no GitHub Releases at all**. README's "latest release" link opens an empty page.
- `.github/workflows/release.yml` is `workflow_dispatch` with `dry_run` defaulting to true. It has
  only ever run as a dry run. Tags were pushed by hand up to `v0.8.2`; `0.9.0`–`0.11.0` have none.
- The archive's server needs `bun install --production` before it runs, so a user needs Bun even
  though the MCP entry says `node`. The zip also has no top-level folder.
- Upstream (`gethopp/figma-mcp-bridge`) releases by manual dispatch with a version input: CI bumps
  `package.json`, commits it to `main`, publishes the server to npm (users get updates through
  `npx -y`), and attaches a plugin-only zip. This fork does not publish to npm
  (`.claude/rules/release.md`), so the archive must carry a runnable server.

**Tech stack:** GitHub Actions (ubuntu-latest, Bun via `oven-sh/setup-bun@v2`,
`softprops/action-gh-release@v3`), Node ≥ 20 at runtime (`server/package.json` `engines`), `bun test`
for the packaging script.

**Worktree:** `../figma-design-relay-releases`, branch `fix/releases` (from `origin/main` at
`065e73c`), dev slot `releases` on port **1996**.

## Decisions

| Topic           | Decision                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger         | `push` to `main`. A release is created when no GitHub Release `v<version>` exists yet; otherwise the run exits cleanly. Docs-only merges don't bump, so they release nothing. `workflow_dispatch` stays for dry runs. |
| Who tags        | The workflow, at the pushed `main` commit (`target_commitish: github.sha`). Nobody tags by hand any more; a hand-pushed tag is still accepted (the release attaches to it).                                           |
| Asset name      | `figma-design-relay.zip`, the same every version, so `releases/latest/download/figma-design-relay.zip` is a permanent link. Plus `SHA256SUMS.txt`.                                                                    |
| Archive layout  | One top-level folder `figma-design-relay/` holding `plugin/`, `server/`, `README.md`, `CHANGELOG.md`, `LICENSE.md`, `VERSION`. Unversioned, so unzipping an update over the old folder keeps both paths valid.        |
| Server deps     | Installed in CI with `bun install --production --frozen-lockfile` inside the staged `server/` and shipped in `server/node_modules`. The user runs `node`, never `bun`. All three deps are pure JS.                    |
| Packaging logic | A script, `scripts/package-release.mjs`, stages the folder and checks it; the workflow only builds, calls it and zips. The script is unit-tested; YAML is not.                                                        |
| Notes           | The `CHANGELOG.md` entry via `check-version.mjs --notes`, as today.                                                                                                                                                   |
| Version         | This is a tooling change: patch bump to **0.11.1**, which also becomes the first real release.                                                                                                                        |
| Review gate     | Per CLAUDE.md: dry run of the workflow on the branch, live Figma check of the dry-run archive, GPT-6.1-Sol review, PR → `dev`, then the `dev` → `main` PR left for the user. Merging that PR publishes 0.11.1.        |

## Global constraints

- Bun for every repo command; the _user_ needs only Node ≥ 20.
- Nothing to npm; `server/package.json` stays `figma-design-relay-server`, `"private": true`.
- Never `git push --tags` (the clone holds upstream's `v0.0.x` tags).
- Every GitHub Action on node24; check `action.yml` `runs.using` at the pinned ref.
- Nothing publishes except from `main` after its PR gate.

## Review focus

The failure modes most likely to bite a user, and where each is pinned:

1. **A dev-slot build ends up in the archive** (wrong id, dials 1996) — the user's plugin never
   connects. Phase 1 tests `refuses a dev-slot build`, `…another port`, `…wrong id`.
2. **Publishing from a branch** by dispatching with `dry_run: false` — an unreviewed release.
   Phase 2 step 5 dispatches exactly that and expects `not main`.
3. **A version already released, or a stray hand-pushed tag** — duplicate or misattached release.
   Phase 2's `decide` step skips the first and fails the second; phase 4's last acceptance check
   watches a docs-only merge skip.
4. **Updating by unzipping over the old folder** leaves stale `node_modules` files. Phase 3's
   _Updating_ says delete first, and why.
5. **Windows paths in MCP JSON** (`C:\Users\…` unescaped) — the client fails to parse its config.
   Phase 3's Windows note.

## Phases

| #   | Phase                                      | Summary                                                                                                                   | Status      |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | [Packaging script](01-package-script.md)   | `scripts/package-release.mjs` stages the archive folder from the builds and fails on anything missing; tested, run in CI. | done        |
| 2   | [Release workflow](02-release-workflow.md) | `release.yml` runs on every push to `main`, skips versions already released, publishes the fixed-name zip and checksums.  | done        |
| 3   | [README download and setup](03-readme.md)  | Quick Start rewritten: requirements, download link, per-client MCP setup, Figma import, updating, troubleshooting.        | done        |
| 4   | [Docs, bump and ship](04-ship.md)          | Release rule, finish-task and CLAUDE.md updated; bump to 0.11.1; dry run; live check of the archive; finish-task.         | in progress |
