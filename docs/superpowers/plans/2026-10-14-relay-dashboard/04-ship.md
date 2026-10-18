# Phase 4 — Ship

[← Overview](00-overview.md)

## Goal and scope

Get the dashboard into the release zip, document it, prove it against real Figma, then land it
through `finish-task`.

**In:** `.github/workflows/release.yml`, `server/package.json` `files`, README, `.claude/` rules
and CLAUDE.md layout, the design-history index, a live-check record, version 0.9.0 and the
changelog. **Out:** any new behaviour.

## Requirements

D10 (ships in the release), plus the repository's live-check and review gates (CLAUDE.md →
Workflow).

## Dependencies

Phases 1–3 complete; `bun run check` green.

## Implementation notes

- The release copies `server/dist` only. `DASHBOARD_DIR` resolves to `../dashboard/` from
  `dist/`, so `server/dashboard/` must sit beside `dist/` in the zip. The test file in it is
  harmless to ship, but the copy excludes it to keep the zip clean.
- The leader's `Dashboard: http://127.0.0.1:<port>/` line goes to stderr, which most MCP clients
  hide, so the README tells people the URL directly.

## Tasks

### Task 1: Ship the page in the release [D10]

**Files:**

- Modify: `.github/workflows/release.yml` (Package release step), `server/package.json` (`files`)

- [x] **Step 1: Copy the dashboard into the zip and check it is there**

In the "Package release" step, after `cp server/bun.lock release/server/`:

```bash
          # The leader serves its status page from dist/../dashboard.
          mkdir -p release/server/dashboard
          cp server/dashboard/*.html server/dashboard/*.css server/dashboard/*.js release/server/dashboard/
          test -f release/server/dashboard/index.html \
            || { echo "ERROR: dashboard files missing from the release"; exit 1; }
```

In `server/package.json`, change `"files": ["dist"]` to `"files": ["dist", "dashboard"]`.

- [x] **Step 2: Dry-run the copy locally**

Run (Git Bash, root):
`rm -rf /tmp/rel && mkdir -p /tmp/rel/server/dashboard && cp server/dashboard/*.html server/dashboard/*.css server/dashboard/*.js /tmp/rel/server/dashboard/ && ls /tmp/rel/server/dashboard`
Expected: `dashboard.css  dashboard.js  index.html  render.js`, and no `render.test.ts`.

- [x] **Step 3: Commit**

```bash
git add .github/workflows/release.yml server/package.json
git commit -m "chore: ship the dashboard files in the release zip"
```

### Task 2: Document the dashboard

**Files:**

- Modify: `README.md`, `.claude/rules/server.md`, `.claude/CLAUDE.md`, `docs/superpowers/README.md`

- [x] **Step 1: README** — after the "### 4. Start using it 🎉" section, add:

```markdown
### 5. Watch it work (optional)

While your AI tool is running, open <http://localhost:1994/> in a browser. The relay's dashboard
shows which Figma files the plugin is open in (and whether each is a design file, FigJam board or
Slides deck), every request your AI tool sends to Figma with how long it took and any error, and
the other relay processes sharing the connection. It is read-only, and it answers only on this
machine. A dev plugin's relay shows its own on its dev port.
```

- [x] **Step 2: `.claude/rules/server.md`** — under Constraints, add:

```markdown
- **The dashboard is read-only and same-origin.** `GET /` and `/api/status` (`src/dashboard-http.ts`)
  refuse any `Host` but `127.0.0.1:<port>`/`localhost:<port>` (DNS rebinding), the API refuses
  foreign `Origin` and cross-site `Sec-Fetch-Site`, and every reply carries a strict CSP. Never add
  a route that calls a tool, and never log a call's params or results in `ActivityLog`. The page's
  files live in `server/dashboard/` and are copied into the release by `release.yml`.
```

- [x] **Step 3: `.claude/CLAUDE.md` layout** — under `server/src/`, add
      `activity.ts   call log + follower registry the dashboard reads` and
      `dashboard-http.ts guard, headers and file table for the status page`; add a line
      `server/dashboard/  the leader's status page: index.html, render.js (tested), dashboard.js/.css`.
      Update the leader line to `leader.ts     HTTP + WebSocket host, and the dashboard`.

- [x] **Step 4: `docs/superpowers/README.md`** — under "Other specs", add:

```markdown
- [`specs/2026-10-14-relay-dashboard-design.md`](specs/2026-10-14-relay-dashboard-design.md) — the
  leader's read-only status page (D1–D11). Built by
  [`plans/2026-10-14-relay-dashboard/00-overview.md`](plans/2026-10-14-relay-dashboard/00-overview.md).
```

- [x] **Step 5: Format and commit**

```bash
bun run format && bunx prettier --check "docs/**/*"
git add README.md .claude/rules/server.md .claude/CLAUDE.md docs/superpowers/README.md
git commit -m "docs: the relay dashboard"
```

### Task 3: Live Figma check

Server routing changed and the bridge now wraps every call, so CLAUDE.md requires a live check
before the PR. Run the `live-figma-check` skill against this worktree's build and dev slot.

- [ ] **Step 1: Build and restart** — `bun run build` in `server/` and `plugin/`; restart the dev
      relay (a leader keeps running the `dist` it started from); relaunch the Dev plugin in one design
      file and one FigJam board.
- [ ] **Step 2: Exercise every path** — open `http://127.0.0.1:<dev port>/` and record each result:
  1. Both files appear with the right badge (Design, FigJam) and "Connected … ago".
  2. A local call (`get_selection` from the agent) appears as "This relay", OK, with a duration.
  3. A follower call (`node .smoke/call.mjs get_node …` against the dev port, which joins as a
     follower) appears as "Follower <pid>", and that pid is listed under Other relay processes.
  4. A failing call (`get_node` with a non-existent id) shows its error text; "Only failed calls"
     shows just it.
  5. Closing the plugin in the FigJam board removes that card on the next poll.
  6. Stopping the relay shows the banner; a new relay taking the port clears it without a reload.
  7. `curl -i -H "Host: evil.example" http://127.0.0.1:<dev port>/api/status` → `403`.
  8. `list_files` from the agent returns the same shape as before (no `connectedAt`).
- [ ] **Step 3: Record** — write `docs/reference/<date>-relay-dashboard-live-check.md` in the shape
      of `2026-10-01-dev-name-port-live-check.md`: tested commit, setup, cases 1–8 with results, and a
      screenshot of the page. Commit with `docs: record relay dashboard live check`.

If Figma or an editor is unavailable, stop and ask the user for an explicit exception. Don't open the PR
with an "unverified" note.

### Task 4: Finish

- [ ] **Step 1:** Run the `finish-task` skill. This is a finished feature, so it bumps the
      **minor** version to **0.9.0** (server and plugin) with a changelog entry under "Added": "A
      read-only relay dashboard at `http://localhost:<port>/`: connected files, recent tool calls and
      follower processes." The skill also refreshes the test counts in CLAUDE.md, gets a separate agent
      to review the full diff, and merges into `dev`, then `main`.
- [ ] **Step 2:** Set every phase's status to **done** in [`00-overview.md`](00-overview.md).

## Acceptance checks

- A release dry run (or the CI artifact) lists `server/dashboard/index.html`.
- The live-check record exists, with all eight cases passing on the merged commit's build.
- `bun scripts/check-version.mjs` reports 0.9.0 with a changelog entry.
