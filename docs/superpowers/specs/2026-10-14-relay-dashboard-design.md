# Relay dashboard — design

**Date:** 2026-10-14 · **Status:** approved for planning · **Plan:**
[`plans/2026-10-14-relay-dashboard/00-overview.md`](../plans/2026-10-14-relay-dashboard/00-overview.md)

## Problem

The relay is invisible. When an agent says "no plugin connected", or a call is slow or fails, the
only evidence is the relay's stderr, which the MCP client usually hides. A designer cannot see which
files the plugin is open in, which editor each one is, which relay process is the leader, or what
the agent just asked Figma for and how it went.

## Decision

The leader serves a read-only status page at `http://127.0.0.1:<port>/`, on the port it already
binds (1994 for the stable relay, the dev slot's port in a worktree). The page polls a JSON status
endpoint every two seconds. There is no build step, no new dependency and no write action.

## Requirements

| Id  | Requirement                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `GET /` on the leader serves the dashboard. Followers serve nothing new.                                                                                                                                                                                                                       |
| D2  | It lists the connected files: name, editor (Design / FigJam / Slides / Dev Mode / unknown), when the file connected, when it last received a call, and its relay file key.                                                                                                                     |
| D3  | It lists the leader's last 200 tool calls, newest first: time, tool, file, origin (this relay or which follower), duration, and OK or the error text. A toggle shows only failed calls.                                                                                                        |
| D4  | It lists the follower processes seen in the last 60 seconds, by process id, with last-seen time and call count.                                                                                                                                                                                |
| D5  | The header shows version, port, leader process id and start time. When a poll fails a banner says contact was lost; it clears by itself when the relay (or a new leader on the same port) answers again.                                                                                       |
| D6  | The log holds only tool name, file key and name, origin, start time, duration, and error text cut to 300 characters. Never params, node ids, script source or returned data.                                                                                                                   |
| D7  | The dashboard is GET-only and cannot call tools or change anything in Figma.                                                                                                                                                                                                                   |
| D8  | Every dashboard route requires `Host` to be `127.0.0.1:<port>` or `localhost:<port>` (stops DNS rebinding). The status API also refuses a foreign `Origin` and any `Sec-Fetch-Site` other than `same-origin`/`none`. Responses carry a strict CSP, `nosniff`, `no-store`, and no CORS headers. |
| D9  | Every value that came from Figma or a plugin is HTML-escaped before display.                                                                                                                                                                                                                   |
| D10 | No new dependencies and no build step: plain HTML, CSS and ES modules in `server/dashboard/`, copied into the release zip.                                                                                                                                                                     |
| D11 | `list_files`, `/rpc`, `/ping` and `/ws` behave exactly as before; existing tests pass unchanged.                                                                                                                                                                                               |

## Out of scope

- Acting on Figma from the page (selecting nodes, running tools). Would need pairing/auth first.
- Push updates (SSE or WebSocket). Two-second polling is enough for one local viewer.
- Keeping history across relay restarts; the log lives in the leader's memory.
- Authenticating the plugin's `/ws` socket, and the DNS-rebinding gap in remote image fetches.
  Both stay open from `docs/reference/2026-10-01-project-review.md`.
- A link to the dashboard from the plugin panel.

## Later candidates

These were proposed alongside the dashboard and can build on its page and status endpoint: a
design-to-code preview, a design-system browser, and a Code Connect manager.
