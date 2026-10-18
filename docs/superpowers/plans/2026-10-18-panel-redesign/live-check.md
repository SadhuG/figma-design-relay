# Live check: plugin panel redesign

[← Overview](00-overview.md)

**Date:** 2026-10-18. **Candidate:** branch `feat/panel-redesign` at `3770f97` (plugin and server
built from that commit). **Editor:** Figma design file "Figma Design Relay", desktop app on
Windows 11.

**Setup:** dev slot `panel-redesign` on port 1999. The relay was held with
`server/.smoke/hold-leader.mjs` and the Dev plugin imported from `plugin/dist/manifest.json`.
Probes (`probe.mjs`, `call.mjs`) joined as followers. A headless Claude Code session
(`claude -p` with an `--mcp-config` pointing at the worktree's `server/dist/index.js`) acted as a
real client. The panel was read from screenshots of the Figma window and compared with Board 10
(Figma node `38:2`).

| Case                                                   | Board 10 card | Result                                                                                                                   |
| ------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Connected, Dev build                                   | 02            | Pass: plane icon, "Live on port 1999", Dev pill "Dev: panel-redesign", `ws://localhost:1999`                             |
| Selection 0, 1 and 3                                   | C             | Pass: "Nothing selected", "1 node", "3 nodes"                                                                            |
| Tool call through a follower (`run-script-smoke`)      | 03d           | Pass: "run-script-smoke is working", the name shown as sent; back to Live about 10 s after the call                      |
| Two clients at once (`run-script-smoke`, `tool-smoke`) | 03b           | Pass: "2 agents working"                                                                                                 |
| Real Claude Code session (follower)                    | 03a           | Pass: Claude Code sends `claude-code`; the panel shows "Claude Code is working", open and collapsed                      |
| Collapse and expand                                    | A, B          | Pass: chevron up when open, down when collapsed; collapsed bar shows plane, Dev pill, chip                               |
| Reopen while collapsed                                 | B             | Pass: closed with `figma.closePlugin()` and relaunched; the plugin opened as the 36 px bar                               |
| Relay stopped                                          | 07            | Pass after fix: faded icon, red chip, "(no answer)", Retry now. Countdown read 10 → 3 s, then "retrying…", then 30 → 6 s |
| Retry now                                              | 07            | Pass: an attempt at once, then the schedule starts over at 1, 2, 5 s                                                     |
| Relay restarted                                        | 02            | Pass: reconnected without user action, back to Live                                                                      |

**Found and fixed during the check (`3770f97`):**

- Figma's plugin iframe has no Inter, so text renders in the wider system font. "Lost the relay ·
  retrying in 25 s" was cut off beside Retry now. The text is now "Relay lost · retry in 25 s",
  and Board 10's card 07 was updated to match.
- With a long agent name, the state chip and the Dev pill shrank together, which cut off "Claude
  Code is working". Now the chip keeps its width (up to 200 px, or 170 px collapsed) and the Dev
  pill gives way, down to 48 px.

## Recheck after the review fixes

The review fixes (`67861d8` and the commit after it) changed the plugin and the server, so the
affected cases were run again on the rebuilt plugin and a restarted relay.

| Case                                                 | Result                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Launch with the relay down                           | Pass: grey "Connecting…" with the normal icon, then red "Retrying…" with the icon faded                  |
| Relay started                                        | Pass: reconnected without user action                                                                    |
| Real Claude Code session                             | Pass: "Claude Code is working", Dev pill truncated first                                                 |
| Port that accepts TCP but never answers (a stand-in) | Pass: "Connecting…" for 5 s, then "Retrying…" with Retry now; attempts kept coming on the retry schedule |
| Real relay back on the port                          | Pass: reconnected without user action                                                                    |

**Not checked live:**

- **The Stable build** (sun icon, version in place of the pill). This worktree always builds the Dev
  variant, and `uiDefine(null, …)` is unit-tested. A build of this branch without a slot is staged
  for the stable import; see the PR or merge notes for its result.
- **A long file name, and redialing after a rename.** A plugin can't change `figma.root.name`. The
  File row uses the same ellipsis rule as the other rows. The rename path reuses the effect cleanup
  that the fileKey case runs.
- **Readable names for Cursor, VS Code and Codex.** Only Claude Code was available. The other
  entries in `AGENT_DISPLAY_NAMES` come from those apps' published client names and are unverified;
  an unlisted name shows as sent.
