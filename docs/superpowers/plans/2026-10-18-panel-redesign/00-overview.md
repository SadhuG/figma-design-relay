# Plugin panel redesign: overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Load this file
> plus the one phase file you are working on, not the whole folder. Steps use checkbox (`- [ ]`)
> syntax for tracking.

## Project

**Goal:** Replace the dark navy plugin panel with the light "Option B" panel from Figma, including
its connection states, a named "agent working" state and a collapse toggle that says which way it
moves.

**Design source (the spec):** Figma file "Figma Design Relay", page "Shortlist directions", frame
**Board 10: Plugin UI, final states** (node `38:2`). It supersedes Board 9's Option B (`17:740`)
and its fixes section (`28:734`). Read the node ids and values below from it. Where this plan and
the board disagree, the board wins and the plan gets fixed.

**Context:** The plugin's UI is React in Figma's plugin iframe (`plugin/src/ui/`). The main thread
(`plugin/src/main/code.ts`) owns the window size and the collapsed preference. The server forwards
every tool call to the plugin as a `BridgeRequest` over the WebSocket, and the UI sees each request
arrive and each response leave.

**Tech stack:** React 18, Vite 5 (single-file build), TypeScript, `bun test`. The server is Node
ESM with `@modelcontextprotocol/sdk` 1.26.0.

**Worktree:** `../figma-design-relay-panel-redesign`, branch `feat/panel-redesign`, dev slot
`panel-redesign` on port 1999. In Figma it runs as **Figma Design Relay (Dev: panel-redesign,
port 1999)**.

## Decisions every phase depends on

| Topic         | Decision                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title bar     | Figma draws it (plugin name and ×). The plugin draws nothing there.                                                                                                                                                                                                                       |
| Window size   | Plugin area **320 × 113** open and **320 × 36** collapsed. Every open state fits 113 px. Buttons in the footer are 17 px tall so the footer stays 34 px.                                                                                                                                  |
| App icon      | 16 px at the left of the footer, 20 px at the left of the collapsed bar. Stable shows the sun tile, Dev shows the plane. 40% opacity while disconnected.                                                                                                                                  |
| Collapsed bar | App icon, grow, Dev pill (Dev only), state chip, toggle. No product name.                                                                                                                                                                                                                 |
| Toggle        | One 24 px button, absolutely placed 6 px from the top and 8 px from the right in both states. Open: chevron **up**, label "Collapse". Collapsed: chevron **down**, label "Expand". `aria-expanded` follows.                                                                               |
| Relay row     | The dial address with its connection type: `ws://localhost:1994`. Appends ` (no answer)` while disconnected.                                                                                                                                                                              |
| Selection row | `Nothing selected`, `1 node`, `N nodes`.                                                                                                                                                                                                                                                  |
| Dev pill      | Kept. Orange `#ffb020`, 4 px radius, mono 10 px `#1e1e1e`, text `Dev: <slot name>`. Takes the version's place in the footer, and sits before the chip in the collapsed bar. The Dev chip text has no "· test build".                                                                      |
| State chip    | Live: `Live on port <port>` / collapsed `Live · <port>`. Working: see Agent label. Lost: `Lost the relay · retrying in <n> s` (or `Lost the relay · retrying…` mid-attempt) / collapsed `Retrying…`. Precedence: lost > working > live.                                                   |
| Agent label   | Working means a request in flight or one finished in the last **10 s**. One agent: `<Name> is working`. Name unknown: `Agent working`. Two or more distinct agents: `<n> agents working`, with the names in the chip's tooltip. Phase 1 has no names, so it always shows `Agent working`. |
| Reconnect     | Retry delays 1 s, 2 s, 5 s, 10 s, then 30 s for every later attempt. A successful connect resets the sequence. **Retry now** connects at once and resets it.                                                                                                                              |
| Sponsor link  | Removed from the panel, and its `hopp-logo.png` is deleted. The README keeps the Hopp credit.                                                                                                                                                                                             |
| Theme         | Light only. Following Figma's theme is out of scope.                                                                                                                                                                                                                                      |
| Panel logic   | Every rule above that is text or timing lives in pure functions in `plugin/src/ui/panel-state.ts`, unit-tested beside it. `App.tsx` only wires them up.                                                                                                                                   |

### Colours (from Board 10)

| Token                | Value                        |
| -------------------- | ---------------------------- |
| background           | `#ffffff`                    |
| label text           | `#757575`                    |
| value text           | `#1e1e1e`                    |
| divider              | `#e6e6e6`                    |
| live (text, dot)     | `#14ae5c`, chip at 12% alpha |
| working (text, icon) | `#ff4fa3`, chip at 12% alpha |
| lost (text, icon)    | `#e5484d`, chip at 12% alpha |
| Dev pill             | `#ffb020`                    |

## Workflow for every phase

Follow `.claude/CLAUDE.md`: test first, `bun run typecheck` / `bun run build` / `bun test` in the
package you touched, `bun run format` from the root. Before merging, run the live Figma check
(`live-figma-check` skill), then `finish-task` with its separate-agent review. Phases 1 and 2 ship
together as one release because phase 1 alone has no styled panel. Phase 3 is its own release.

## Phases

| #   | Phase                            | Summary                                                                                                                                       | Status      |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | [Panel logic](01-panel-logic.md) | Pure, tested functions for every text and timing rule: selection plurals, relay address, chip text, reconnect delays and the activity window. | not started |
| 2   | [Panel UI](02-panel-ui.md)       | The light panel itself: build-time version and slot name, icons, layout and CSS, the toggle, reconnect with Retry now, the new window height. | not started |
| 3   | [Agent names](03-agent-names.md) | The server reads each MCP client's name and sends it with every request, followers included. The panel turns it into a readable name.         | not started |

**Out of scope:** Board 10's "Later" states: 04 Selection sent, 05 Syncing layers, 06 Diagram
drawn and 08 Leader and followers. Each needs a decision or new data first; the board lists the open
question under each one. The dark theme is out of scope too.
