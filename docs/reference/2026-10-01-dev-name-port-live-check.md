# Dev plugin names carry their port (0.7.7): live Figma verification

Checked on 2026-10-01 (Asia/Calcutta) on branch `feat/dev-name-port`. The plugin and server were
built from `0096467`, the commit carrying the change. Every later commit on the branch touches only
docs, `CHANGELOG.md` and the two `package.json` versions, and the plugin build embeds no version, so
the tested build is the one that merges. The leader's `/ping` still read `0.7.6` because it started
before the version bump.

## Setup

- Worktree `figma-design-relay-dev-name-port` on dev slot port 1996, both packages built, and
  `node .smoke/hold-leader.mjs` holding the leader on `127.0.0.1:1996`.
- The user imported `plugin/dist/manifest.json` in the Figma desktop app and ran the Dev plugin in
  a design file. The same change, cherry-picked onto `chore/project-cleanup` as `7a33134` (identical
  content to `0096467`; slot port 1995), was imported and run too. The FigJam and Slides evidence
  below comes from that build; the change is a manifest name only and does not vary by editor.
- Probes ran through `server/.smoke/` as followers, crossing the HTTP `/rpc` hop to the leader and
  the WebSocket to the plugin.

## Results

| Check                        | Live evidence                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name in the Development menu | The user confirmed **Figma Design Relay (Dev: dev-name-port, port 1996)** and **Figma Design Relay (Dev: cleanup, port 1995)** as distinct entries beside the stable **Figma Design Relay**. |
| Connects on its slot port    | `list_files` on 1996 returned the open design file; `run_script` returned `figma.pluginId` `figma-design-relay-dev-dev-name-port`, so the plugin id is unchanged by the rename.              |
| Follower read                | `get_metadata` through the follower returned the file's name, editor type and six pages.                                                                                                     |
| Other editors                | The renamed cleanup plugin on 1995 was connected in a design file, a second design file, a FigJam board and a Slides deck at once (`list_files`).                                            |
| Stable plugin unaffected     | The stable **Figma Design Relay** (not rebuilt by this branch) connected on 1994 in a design file alongside the Dev imports; its name and id are unchanged.                                  |

## Found along the way

Imports made from a worktree's `plugin/manifest.json` (the checked-in stable manifest) showed up as
plain **Figma Design Relay** and could not reach their slot. Re-importing each worktree's
`plugin/dist/manifest.json` fixed it. The symptom is now in the `live-figma-check` skill.
