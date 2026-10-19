# Socket-replacement clearing live check — 2026-10-19

Closes the P2 from the GPT-6.1-Sol promotion review, round 2, of
[PR #23](https://github.com/SadhuG/figma-design-relay/pull/23): commit `0e79d29` changed
`plugin/src/ui/App.tsx` so the panel forgets a socket's requests whenever the socket is
**replaced**, not only when it closes. This is the live evidence for that path.

## Candidate and setup

- **Candidate:** `fix/dashboard-review-followup` at `c354cc4f66381d4fef04ef5e880906f9d2299f86`.
  Its tree equals the promotion head, `dev` at `39e5f070d9fce56214bc561edc582ba2651d5db2`
  (`git diff c354cc4 39e5f07` is empty).
- **Plugin build:** the running Dev plugin's `plugin/dist`. After the check it was rebuilt from
  `c354cc4` and compared with `cmp`: `index.html`, `code.js` and `manifest.json` are byte-identical.
  SHA-256 `index.html` `f72b2a0b6de7ad6162b1a8d9b56b88c097e61acfd228a3944312e0988f22b934`,
  `code.js` `e61804ce672787653b5199e7c25e1bb5a67c0ea209c55faa87e209655895ed8a`.
- **Relay:** the worktree's leader, process 13920, on `127.0.0.1:1996`, unchanged since the
  0.10.1 record in [the follow-up evidence](2026-10-19-dashboard-review-followup.md). This change
  is plugin UI only, so no server restart was needed.
- **Editor:** Figma desktop, design file "Figma Design Relay", running
  **Figma Design Relay (Dev: relay-dashboard, port 1996)**. Selection: `7:7273`
  "Board 7: Directions, round 2", 12,320 layers, so `get_selection` takes about 8.5 s with
  Figma in the foreground.
- **Calls:** `server/.smoke/call.mjs get_selection` and `probe.mjs` from the worktree, both
  follower processes proxying to the leader. Panel screenshots used `CopyFromScreen` on the
  foreground window after `SetProcessDPIAware`.

## How the replacement was triggered

The panel's connect effect depends on `status.fileKey`, `status.fileName` and
`status.editorType`, so a new file name replaces the socket through the effect cleanup and a
fresh `connect()`. These are the two deliberate paths `0e79d29` covers. A plugin cannot rename
the file: `figma.root.name = …` is silently ignored. A file rename does not itself trigger a
status update; changing the selection triggers `sendStatus()` with the new name. So:

1. The file was renamed in Figma's UI (double-click the name in the left sidebar, type, Enter).
   The panel is not told yet.
2. `get_selection` was started.
3. Two seconds in, a `run_script` probe cleared the selection and restored it 150 ms later.
   The status that followed carried the new name, and the panel replaced its socket mid-read.

## Cases and results

| #   | Case                                      | Result                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Control: `get_selection`, no replacement  | Returned the board (6,352,601 chars). The panel showed **Sent to your agent** with **Show in canvas**, and "1 node · sent just now".                                                                                                                                                              |
| 2   | Mid-read, before the replacement          | **Reading the layer tree… 10%**.                                                                                                                                                                                                                                                                  |
| 3   | Socket replaced mid-read                  | About a second after the selection change, the panel showed the new name and **Connecting…**. Working and progress were gone. The leader rejected the old socket's pending call: `get_selection` returned `isError: true`, `Plugin disconnected: Figma Design Relay (unsaved-mvfeakk7-ymql17mb)`. |
| 4   | Late reply, about 4 s after the rejection | The plugin finished the read and posted its `selection-sent` and response; nothing aborts a read when a socket goes. The panel read **Leader · 5 followers**, "1 node", with **no Sent**, no "sent just now" and no working state, while the selection matched the read nodes.                    |
| 5   | About 12 s after the rejection            | Unchanged: no Sent, no working state.                                                                                                                                                                                                                                                             |
| 6   | Reconnected socket and rename back        | `list_files` reported `fileName` "Figma Design Relay socket test" from the new socket, then "Figma Design Relay" after renaming back the same way. The panel returned to Live.                                                                                                                    |

The `selection-sent` that the control turned into Sent (case 1) arrived again in case 4 for a
request the panel had forgotten. `NoticeBoard.record` ignores ids that are neither running nor
finished, so it did not show. Before `0e79d29`, a replacement left the old socket's request
registered, which is the stale-Sent path the review identified.

An earlier attempt, before the steps above, renamed the file during the read itself. That run lost
the race: the read finished about 0.3 s before the selection change, so `get_selection` succeeded
on the old socket. It showed that a replacement also clears a just-finished request's Sent, but
it did not exercise a late reply, so it is not counted.

## Screenshots

1. [Control: Sent to your agent](assets/socket-replacement-2026-10-19/1-control-sent.png)
2. [Mid-read progress](assets/socket-replacement-2026-10-19/2-reading.png)
3. [Socket replaced: new name, Connecting…](assets/socket-replacement-2026-10-19/3-socket-replaced.png)
4. [Late reply +4 s: no Sent](assets/socket-replacement-2026-10-19/4-late-reply-plus-4s.png)
5. [Late reply +12 s: no Sent](assets/socket-replacement-2026-10-19/5-late-reply-plus-12s.png)
6. [Renamed back, Live](assets/socket-replacement-2026-10-19/6-renamed-back.png)

The follower count is display telemetry and includes the probe processes from these runs.
