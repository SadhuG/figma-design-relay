# Phase 1: Packaging script

[← Overview](00-overview.md)

## Goal and scope

Move the archive's contents out of `release.yml` into a tested script that stages the
`figma-design-relay/` folder and refuses to stage a broken or dev-slot build.

- **In:** `scripts/package-release.mjs`, its tests, a CI step that runs them.
- **Out:** zipping, checksums, tagging (phase 2); README (phase 3).

## Requirements

- Staged layout exactly as the overview's _Archive layout_ row, with `VERSION` holding the bare
  version and a trailing newline.
- `server/` holds `dist/`, `dashboard/*.{html,css,js}`, `package.json`, `bun.lock` and a
  production-only `node_modules/` (`@modelcontextprotocol/sdk`, `ws`, `zod`; no `typescript`, no
  `@figma/plugin-typings`, no `@types/*`).
- `plugin/` holds `manifest.json` (the stable one, id `figma-design-relay`) and `dist/`.
- The out directory is emptied first, so a second run never ships leftovers.
- Any failed check prints `ERROR: <what> — <what to do>` and exits 1.

## Tasks

### Task 1: `stageRelease` and `checkStaged`

**Files:**

- Create: `scripts/package-release.mjs`
- Test: `scripts/package-release.test.mjs`
- Modify: `package.json` (root `test` script also runs `bun test ./scripts`), `.github/workflows/ci.yml`
  (new step "Script tests": `bun test ./scripts`, after the version check)

**Interfaces:**

- Produces:
  - `stageRelease({ root: string, outDir: string, version: string, install: (serverDir: string) => void }): string`
    — returns the staged folder path `<outDir>/figma-design-relay`. `install` defaults to running
    `bun install --production --frozen-lockfile` with `cwd: serverDir`.
  - `checkStaged(dir: string): string[]` — returns one problem string per failed check, `[]` when
    the folder is releasable.
  - CLI: `bun scripts/package-release.mjs <outDir>` — reads the version with the same logic as
    `check-version.mjs`, stages, checks, prints the staged file list (`node_modules` as one
    `server/node_modules/ (<n> packages)` line), exits 1 on any problem.

- [x] **Step 1: Write the failing tests**

  Each test builds a fixture repo in `mkdtempSync(join(tmpdir(), "relay-pkg-"))`: `plugin/manifest.json`
  (`{"id":"figma-design-relay","networkAccess":{"allowedDomains":["ws://localhost:1994"]}}`),
  `plugin/dist/code.js`, `plugin/dist/index.html` containing `ws://localhost:1994`,
  `server/dist/index.js` starting `#!/usr/bin/env node`, `server/package.json`, `server/bun.lock`,
  `server/dashboard/index.html|render.js|dashboard.css`, root `README.md`, `CHANGELOG.md`,
  `LICENSE.md`. The `install` stub writes `node_modules/{@modelcontextprotocol/sdk,ws,zod}/package.json`.

  - `stages the documented layout` — `checkStaged(staged)` is `[]`; `VERSION` reads `"0.11.1\n"`;
    the staged folder's basename is `figma-design-relay`.
  - `empties a stale out directory` — a file `figma-design-relay/old.txt` from before is gone.
  - `refuses a dev-slot build` — fixture adds `plugin/dist/manifest.json`; problems include one
    matching `/dev manifest/`.
  - `refuses a plugin that dials another port` — `index.html` holds `ws://localhost:1996`;
    problems match `/1994/`.
  - `refuses a manifest with the wrong id` — id `figma-design-relay-dev-x`; problems match `/id/`.
  - `refuses a server without the node shebang` — problems match `/shebang/`.
  - `refuses dev dependencies` — stub also writes `node_modules/typescript/package.json`; problems
    match `/typescript/`.
  - `refuses missing runtime dependencies` — stub writes nothing; problems name `ws`.
  - `refuses missing dashboard files` — no `server/dashboard/index.html`; problems match `/dashboard/`.

- [x] **Step 2: Run them to see them fail**

  Run: `bun test ./scripts`
  Expected: FAIL — `Cannot find module './package-release.mjs'`.

- [x] **Step 3: Implement `stageRelease` and `checkStaged` in `scripts/package-release.mjs`**

  Empty only `<outDir>/figma-design-relay`, and only when it is missing, empty or an earlier
  staging (a `VERSION` plus staged names only) that neither is nor contains the repository by real
  path; never `rmSync(outDir)`. Then `cpSync` per path. Export both functions;
  run the CLI only when `import.meta.main`. The plugin port check reads `plugin/dist/index.html` (the
  UI holds the WebSocket address) and fails if it does not contain `ws://localhost:1994` or contains
  any other `ws://localhost:<port>`.

- [x] **Step 4: Run them to see them pass**

  Run: `bun test ./scripts`
  Expected: 9 pass, 0 fail.

- [x] **Step 5: Run it on the real builds**

  Run (in the worktree, after `mv .dev-slot.json /tmp/` so the plugin builds as stable, then both
  builds): `bun scripts/package-release.mjs .release-test`
  Expected: exit 0; the list has one line `server/node_modules/ (<n> packages)` instead of every
  file, and `node .release-test/figma-design-relay/server/dist/index.js` starts (Ctrl-C it). Restore `.dev-slot.json` and rebuild. Add `.release-test/` to `.gitignore`.

- [x] **Step 6: Commit**

  ```bash
  git add scripts/package-release.mjs scripts/package-release.test.mjs package.json .github/workflows/ci.yml .gitignore
  git commit -m "feat(release): stage the release archive with a tested script"
  ```

## Dependencies

None.

## Acceptance checks

- `bun test ./scripts` passes locally and in CI's new step.
- Running the CLI against a dev-slot build exits 1 naming the dev manifest.
