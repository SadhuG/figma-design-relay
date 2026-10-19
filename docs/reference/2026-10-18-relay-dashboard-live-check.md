# Relay dashboard verification — 2026-10-18–19

Status: **all eight required live cases passed.** Final evidence review and the GitHub release
workflow dry run remain before opening the PR. FigJam relaunch was requested from the user after
the deliberate disconnect check; restoration has not yet been observed.

## Candidate and setup

- Tested build: `1878eee961c8064bf36e2d82cacb24cb1275a17d`, version 0.9.0. Merge `b0a3714`
  incorporates the upstream promotion `origin/main` (`2a43cfb`) with an empty tree diff against
  the tested commit. No runtime rebuild was needed for that merge.
- Worktree: `C:/Users/sadhu/code/figma-design-relay-relay-dashboard`.
- Dev plugin: `Figma Design Relay (Dev: relay-dashboard, port 1996)`.
- Stable relay and MCP configuration were not changed.
- The candidate preserves the panel's MCP agent name and the dashboard's call origin together:
  `Bridge.sendWithParams` accepts the agent as argument five and origin as argument six. Regression
  tests cover a local Node, follower Node, direct follower RPC and `save_screenshots` export.

## Live results

The first session ran on leader 2640, held by MCP client process 7788. The user launched the Dev
plugin in Design, FigJam and Slides. The browser was opened through T3 `preview_status` and
`preview_open`. Tool calls used MCP over stdio; independent clients became followers on port 1996.

| Plan case             | Result and evidence                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Connected files    | Passed: Design **Figma Design Relay**, FigJam **Untitled** and Slides **Untitled** displayed correct badges, file keys and connected ages. [Connected screenshot](assets/relay-dashboard-2026-10-19/connected.png). After user relaunch, the live DOM again showed all badges and current last-call ages; the in-flight timestamp check below also passed.                                                                                        |
| 2. Local call         | Passed: original holder's `get_selection` appeared as **This relay**, **OK**, **8 ms**. Its attempted `get_node` used the obsolete `nodeIds` MCP argument and failed validation, so that attempt is not counted as a plugin error.                                                                                                                                                                                                                |
| 3. Follower node call | Passed: follower **13164** sent MCP `get_node` with `nodeId: "6:5440"` and the Design file key. It returned the requested **6:5440**, **Board 6**, **TEXT**, `isError: false`. The dashboard DOM showed its **Follower 13164**, **23 ms**, **OK** row and process **13164** with **9** calls. `get_selection` also succeeded in all three editors.                                                                                                |
| 4. Failure filtering  | Passed: real plugin errors said **Node not found: 999999:1**. Clicking **Only failed calls** left exactly three failed rows and zero OK rows. [Filter screenshot](assets/relay-dashboard-2026-10-19/failed-filter.png).                                                                                                                                                                                                                           |
| 5. FigJam close       | Passed: targeted `run_script` in FigJam file `unsaved-mverd7jw-l4ocpz7f` scheduled `figma.closePlugin()` after 300 ms. The next status had only Design and Slides. The live dashboard DOM then reported `figjamPresent: false`, displaying only Design and Slides cards. User relaunch was requested afterward.                                                                                                                                   |
| 6. Relay handover     | Passed: stopped only verified dashboard owner 7788 and child leader 2640. The offline banner appeared. New hidden holder **37380**, child leader **10032**, took port 1996 and the same browser page recovered. `performance.timeOrigin` stayed **1792357018201.4** and navigation count stayed **1**, proving no reload. [Offline](assets/relay-dashboard-2026-10-19/offline.png), [recovered](assets/relay-dashboard-2026-10-19/recovered.png). |
| 7. Host guard         | Passed: `curl.exe` to live `/api/status` with `Host: evil.example` returned **403**. The Node 24.20.0 malformed-target harness also passed after the tree-neutral main merge.                                                                                                                                                                                                                                                                     |
| 8. Tool shape         | Passed: MCP `list_files` returned only `fileKey`, `fileName`, `editorType` for each file; neither `connectedAt` nor `lastCallAt` leaked into that tool's response.                                                                                                                                                                                                                                                                                |

## Remaining gates and current state

The user recovered the earlier native manifest-picker/plugin-environment problem and relaunched
the Dev plugin in all three editors. Holder 37380 / leader 10032 remains on 1996. After the targeted
FigJam close, Design and Slides remain connected; user FigJam relaunch was requested. No design
nodes were created, changed or deleted; no blind keyboard input was performed. Temporary follower
clients 12576 and 13164 and their verified probe parents were stopped after verification. The
original untracked `server/.smoke/dashboard-live.mjs` is preserved unchanged; corrected probes are
ignored local helpers under `server/logs/`.

Live P2 verification used a read-only two-second promise in `run_script`: while it was still
pending and absent from completed activity, Design `lastCallAt` advanced from **1792384419331** to
**1792384475586**. After completion, it remained **1792384475586**. The browser displayed current
last-call ages for Design, FigJam and Slides. Concurrency and history eviction are additionally
covered by the regression tests.

The continuous recovery browser tab was `tab_3_05bd8dd5-a0da-4f66-8d78-c89f598e6181`. A later input
attempt returned **The calling provider no longer owns an active thread run**. Fresh T3 tabs restored
DOM evaluation for the remaining cases. Additional screenshots failed with
**PreviewAutomationTimeoutError: snapshot timed out after 15000ms**, followed by
**PreviewAutomationNoAvailableHostError**. A bounded `preview_status` / `preview_open` recovery
restored live DOM inspection, including FigJam card absence. The fallback browser reported
**Browser is not available: iab**. The four saved screenshots above remain valid evidence; no
additional screenshot is claimed. The final new browser tabs used the default unchecked filter.

## Automated and packaging evidence

Root `bun run check` passed: server **450 pass, 2 Windows skips** (452 total), plugin **381 pass**,
both builds, plugin type-check, formatting and version check. Frozen installs brought the local
Figma typings to the versions in the merged lockfiles without modifying them.

Local packaging using the workflow's file selection produced exactly
`server/dashboard/{index.html,dashboard.css,dashboard.js,render.js}`, excluding the test file.
Archive SHA-256: `4C46C9899D3968EC5511606DDCA5A272CC776FC3FB67B12E0A5B78D8F754589C`.
This checks packaging selection; the local plugin build uses its Dev manifest. The actual GitHub
Release workflow with `dry_run: true` remains required after the reviewed live candidate can be pushed.

SHA-256 hashes of the exact tested build:

| File                     | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `server/dist/index.js`   | `FECCCBD1EDB82441E7AADA4AEEE40168CA26AFA22B79EAB2C3CA18636E12AD04` |
| `server/dist/bridge.js`  | `D40F5C60C66B9D29561B8D1A821CC0F51995B3A0C17E49BF24B37BF3C31902A4` |
| `server/dist/leader.js`  | `85B3CD52232BF61E16DB7E278B090EC353F68917CA02CED40103B7F05CAC9A19` |
| `plugin/dist/code.js`    | `94982AEA7866D0B649105E25E1386FFF49DEAEAFE0AB5ABC2E8BE2015378535B` |
| `plugin/dist/index.html` | `E06991F3AAEC35F7ABBFA933AD343B1824F737B830D03BC3ECF4A9EC0ABA5CC5` |

## Independent review findings addressed

- P1: `new URL` in the GET routing listener could throw on `//` and terminate the Node leader.
  Commit `4d14be7` catches malformed GET targets with 400 and closes malformed upgrade sockets.
  Its regression test first reproduced the uncaught `ERR_INVALID_URL`. After the fix, both the
  test and `node server/.smoke/dashboard-routing.mjs` (Node 24.20.0, after building) confirm that
  malformed requests are rejected, `/ping` and `/api/status` remain healthy, and foreign Host
  requests still receive 403. The smoke harness uses an ephemeral port and never touches Figma.
- P2 (D2): file-card last-call time was derived from the bounded, completed activity history.
  The bridge now retains optional `lastCallAt` on each connection at dispatch; the status API and
  renderer use it while `list_files` keeps its prior shape. Regression tests first failed for
  in-flight calls, reversed completion order, eviction by another file's 201 calls, and rendering
  a timestamp independently of activity history; all pass after the fix.

Independent review approved the full candidate through `ad1b0ba`, the documentation/DNS refresh
`ad1b0ba..d059146`, and upstream refresh `d059146..1878eee`, with no remaining findings. The later
main merge is tree-neutral. This final evidence update still needs independent review, followed
by the release workflow dry run.
