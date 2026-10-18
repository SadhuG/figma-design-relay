# Plugin panel "Later" states: overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task by task. Load this file plus the one phase file you are working on, not the whole
> folder. Steps use checkbox (`- [ ]`) syntax for tracking.

## Project

**Goal:** Add Board 10's four "Later" panel states: **04 Selection sent**, **05 Syncing layers**,
**06 Diagram drawn** and **08 Leader and followers**.

**Design source (the spec):** Figma file "Figma Design Relay", page "Shortlist directions", frame
**Board 10: Plugin UI, final states** (`38:2`), section **Later · waits on decisions** (`38:924`).
Cards: 04 `38:1001`, 05 `38:1073`, 06 `38:1145`, 08 `38:1215`. Where this plan and the board
disagree, the board wins and the plan gets fixed. The earlier panel work is in
[`../2026-10-18-panel-redesign/00-overview.md`](../2026-10-18-panel-redesign/00-overview.md); its
decisions (window size, toggle, Dev pill, retry rules, light theme) still hold.

**Context:** The panel is React in the plugin iframe (`plugin/src/ui/`); `App.tsx` wires pure rules
from `panel-state.ts`. The main thread (`plugin/src/main/code.ts`) runs every request and can post
the UI extra messages. The leader (`server/src/leader.ts`) owns the plugin sockets through
`Bridge`; followers reach it over HTTP `/rpc`, and the election pings `/ping` every 3–5 s while a
process is a follower.

**Tech stack:** React 18, Vite 5, TypeScript, `bun test`; Node ESM server with `ws`.

**Worktree:** `../figma-design-relay-panel-later-states`, branch `feat/panel-later-states` (from
`origin/dev`), dev slot `panel-later-states` on port **1995**. In Figma it runs as **Figma Design
Relay (Dev: panel-later-states, port 1995)**.

## Decisions (made by the user on 2026-10-19)

| Topic                 | Decision                                                                                                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 04 trigger            | Any request that **reads the current selection**: `get_selection`; `get_design_context` with no node id and a non-empty selection; `get_screenshot` with no node ids. The main thread posts `selection-sent` with the node ids it read.                                                                   |
| 04 timing             | Ranks below working, so it shows once the working state ends, and lasts **10 s** after that: it expires `WORKING_WINDOW_MS + SENT_WINDOW_MS` (10 s + 10 s) after the last request that finished since it was recorded.                                                                                    |
| 04 text               | Chip `Sent to your agent` / collapsed `Sent`, orange `#ff4f1a`, selection icon. Selection row `<count> · sent just now` while the chip shows and the current selection is exactly the nodes that were sent. Footer button **Show in canvas** (white, `#e6e6e6` border) zooms to the nodes that were read. |
| 05 trigger            | Reads that serialize the layer tree: `get_document`, `get_selection`, `get_node`, `get_design_context`. The main thread counts the visible nodes the read will cover (within its depth), then posts `read-progress` with a whole percent as nodes are serialized, at most every **200 ms**.               |
| 05 timing             | Shows only once a read has run **500 ms** and a percent has arrived; gone when its response leaves.                                                                                                                                                                                                       |
| 05 text               | `Reading the layer tree… 62%` / collapsed `Syncing 62%`, purple `#7c5cff`, layers icon.                                                                                                                                                                                                                   |
| 06 trigger            | A successful `render_diagram` (what `generate_diagram` calls; FigJam only). The main thread posts `diagram-drawn` with the created node ids.                                                                                                                                                              |
| 06 timing             | Shows at once (ranks above working) and goes when **another request starts**, after **60 s**, or when the user clicks Select it.                                                                                                                                                                          |
| 06 text               | `Diagram drawn on this page` / collapsed `Diagram drawn`, red `#d62828`, connected-shapes icon. Footer button **Select it**: filled `#d62828`, white text; selects the diagram and zooms to it.                                                                                                           |
| 08 tracking           | Followers send `x-relay-instance: <pid>` on `/rpc` and on the election's `/ping`. The leader counts distinct ids heard in the last **60 s** (same names as the unmerged `feat/relay-dashboard` branch: `INSTANCE_HEADER`, `INSTANCE_ID`, `readInstance`, `FollowerRegistry`, `FOLLOWER_STALE_MS`).        |
| 08 delivery           | The leader sends `{ "type": "relay-status", "followers": n }` over the socket on connect and whenever the count changes (rechecked every **5 s**), only to plugins that dial with `relayStatus=1` in the query, so older plugins never see an unknown message.                                            |
| 08 text               | With ≥1 follower the resting chip is `Leader · 2 followers` (`· 1 follower`) / collapsed `Leader +2`, blue `#3d5afe`, darts icon. With none it stays `Live on port <port>`.                                                                                                                               |
| Chip precedence       | connecting > lost > syncing > diagram > working > selection sent > leader > live.                                                                                                                                                                                                                         |
| Footer right slot     | Retry now (lost) > Select it (diagram chip) > Show in canvas (sent chip) > Dev pill / version.                                                                                                                                                                                                            |
| Panel ↔ main messages | Main → UI: `read-progress {requestId, percent}`, `selection-sent {requestId, nodeIds}`, `diagram-drawn {requestId, nodeIds}`, `plugin-status` gains `selectionIds`. UI → main: `show-nodes {nodeIds, select}`. Events are posted before the response they belong to.                                      |
| Review gate           | After implementation an independent **GPT-6.1-Sol** agent (T3 `delegate_task`, provider `codex`) reviews the branch; fix and re-review until it is satisfied. Then PR → `dev`, merge it, open `dev` → `main` and leave that for the user. Written into CLAUDE.md and `finish-task` in phase 5.            |

All text and timing rules live in pure functions in `plugin/src/ui/panel-state.ts` (UI) and
`plugin/src/main/read-progress.ts` (main), unit-tested beside them.

## Phases

| #   | Phase                                   | Summary                                                                                                         | Status      |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | [Panel logic](01-panel-logic.md)        | Pure rules: chip precedence and new tones, the notice board for Sent and Diagram, syncing visibility, row text. | not started |
| 2   | [Main thread events](02-main-events.md) | Read progress through the serializer, the selection-sent and diagram-drawn events, `show-nodes`, selection ids. | not started |
| 3   | [Follower count](03-follower-count.md)  | Instance header on follower calls, the leader's registry, the `relay-status` push to opted-in plugins.          | not started |
| 4   | [Panel UI](04-panel-ui.md)              | Icons from Board 10, chip tones and buttons in CSS, App wiring for every new message.                           | not started |
| 5   | [Ship](05-ship.md)                      | Live check in Figma (design + FigJam), Board 10 update, repo rule, docs, GPT-6.1-Sol review, PRs.               | not started |

**Out of scope:** progress for `get_layout_tree` (synchronous, it can't report mid-run), a dark
theme, and following Figma's theme.
