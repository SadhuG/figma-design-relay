# Live check: the panel's later states

[← Overview](00-overview.md)

**Date:** 2026-10-19. **Candidate:** branch `feat/panel-later-states` at `594f8ae` (plugin and
server built from that commit). **Editors:** Figma design file "Figma Design Relay" and a blank
FigJam board, desktop app on Windows 11.

**Setup:** dev slot `panel-later-states` on port 1995. The relay was held with
`server/.smoke/hold-leader.mjs`; every tool call went through `call.mjs`, which joins as a
follower, so each case also covers the follower path. The Dev plugin was relaunched with Run last
plugin (`^%p`) after each rebuild. The panel was read from screenshots of the Figma window
(`CopyFromScreen`, plus a 150 ms burst capture for the moving states) and compared with Board 10's
cards (Figma node `38:924`).

| Case                                                       | Card | Result                                                                                                                       |
| ---------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `get_selection` with 3 nodes selected                      | 04   | Pass: "tool-smoke is working", then 10 s later "Sent to your agent", "3 nodes · sent just now" and Show in canvas            |
| Show in canvas after zooming away to 5%                    | 04   | Pass: the viewport zoomed back to the three nodes that were read                                                             |
| Selection changed after the read                           | 04   | Pass: the chip still says Sent, the Selection row drops "· sent just now"                                                    |
| Sent window                                                | 04   | Pass: gone about 20 s after the last call ended (10 s working, then 10 s Sent)                                               |
| `get_document` on a 30,300-layer page (temporary, deleted) | 05   | Pass after the fix below: "Reading the layer tree… 9%" climbing to 71%+ in steps every 200–400 ms; collapsed "Syncing 9%"    |
| Small reads                                                | 05   | Pass: under 500 ms they show only the working chip                                                                           |
| `generate_diagram` in FigJam                               | 06   | Pass: "Diagram drawn on this page" with a red Select it, at once                                                             |
| Select it after deselecting and zooming out                | 06   | Pass: the 5 new nodes selected and zoomed to; the chip cleared                                                               |
| Another call after the diagram                             | 06   | Pass: the chip gives way to "tool-smoke is working"                                                                          |
| 60 s with no calls                                         | 06   | Pass: still shown at 50 s, gone at 62 s                                                                                      |
| Follower probes running                                    | 08   | Pass: "Leader · 1 follower", "Leader · 2 followers", collapsed "Leader +2"; back to "Live on port 1995" after a quiet minute |
| Collapsed bar for each state                               | all  | Pass: "Sent", "Syncing 9%", "Diagram drawn", "Leader +2"                                                                     |
| Regression: relay stopped, then restarted                  | 07   | Pass: "Relay lost · retrying…" with Retry now and "(no answer)"; reconnected without user action, back to Live               |

**Found and fixed during the check (`594f8ae`):** the first build never showed Syncing. Figma
delivers a plugin's messages only when its main thread yields, and the serializer's walk is a
chain of resolved promises that never yields, so every `read-progress` message arrived together
with the response. Timing inside the plugin showed a 30k-layer read spends about 12 s on the main
thread, almost all of it in bursts after each node's design lookups resolve. The fix: the
serializer passes a checkpoint on each node's entry and after each design lookup
(`CHECKPOINTS_PER_NODE = 4`); once per 200 ms the reporter opens a pause there, and on resume lets
parked steps through in batches sized to what the last cycle managed. The read now takes about
13.5 s instead of 12.2 s on that page, in exchange for live progress and a Figma window that stays
responsive.

**Test artefact, not a defect:** zoom keystrokes sent while the first diagram was still selected
turned its labels struck-through; a freshly drawn diagram had `textDecoration: NONE`. All test
diagrams were deleted afterwards.

## Recheck after review round 1

Round 1's fixes (`d5e2fd0`) changed the plugin only: `NoticeBoard` now ignores events from
requests that didn't start on the current socket, and progress posts keep their own 200 ms clock.
The plugin was rebuilt from `d5e2fd0` and launched in the design file (by name, from Figma's
Actions menu: another session's Dev plugin was "last plugin" by then).

| Case                                  | Result                                                                |
| ------------------------------------- | --------------------------------------------------------------------- |
| `get_selection` with 3 nodes selected | Pass: "Sent to your agent", "3 nodes · sent just now", Show in canvas |
| `get_document` on a 30,300-layer page | Pass: "Reading the layer tree… 7%" climbing; page deleted afterwards  |
| Follower probe                        | Pass: "Leader · 1 follower"                                           |

The late-event case itself (socket closed mid-request) is covered by unit tests: it needs the
relay killed while the main thread is still serializing, which the harness can't time reliably.

## After review round 2

`0e79d29` makes the panel forget a socket's requests whenever the socket is replaced, not only
when it closes. The rebuilt plugin hot-reloaded and reconnected through the changed `connect()`
path, and `get_selection` through a follower answered normally. The panel itself wasn't
screenshotted again: the machine was in use and Figma could not be brought to the front. The
change only adds clearing calls; the visible states were checked after round 1.
