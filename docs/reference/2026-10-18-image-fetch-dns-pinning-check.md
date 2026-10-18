# DNS pinning integration verification

The DNS pinning branch was integrated with `origin/dev` (`1a8af14`) and then
`origin/main` (`cd2b6ed`) on 2026-10-18. Integration commit: `752bcef`. The release
candidate updates both package versions to 0.8.1. The earlier
[October 2 report](2026-10-02-image-fetch-dns-pinning-live-check.md) describes the old build;
it does not verify this integrated candidate.

## Automated verification

- Server: 352 tests, 350 passing and two Windows symlink skips; build passes.
- Plugin: 257 passing tests, zero type errors, build passes.
- Both packages were rebuilt after the 0.8.1 version change.
- Root `bun run check` passes, including version validation and formatting.
- Node 24.20.0 fetched Google's HTTPS PNG (5,969 bytes), refused `localtest.me`
  as an internal address, and refused `wrong.host.badssl.com` with
  `ERR_TLS_CERT_ALTNAME_INVALID`.
- Built SHA-256: `image-fetch.js` `96CCE683…1723C96`, `tools.js`
  `AE39EFC6…9DC233E9`, plugin `code.js` `2781125A…EFBA812`, plugin
  `index.html` `018FF7C0…5BF76C1`.

## Current live blocker

The candidate relay started from this worktree's built `server/dist/index.js` on
`127.0.0.1:1995` (dev slot `image-fetch-dns-pinning`). Its `list_files` call returned
`[]`. Read-only `list_files` calls to the running stable relay on 1994 and the other
development relay on 1998 also returned `[]`.

Figma desktop showed “An error occurred while loading the plugin environment” and
“Some changes won't be synced until Figma is able to reconnect.” Importing the worktree's
`plugin/dist/manifest.json` reached the native manifest picker, but the available Computer
Use surface did not provide a targetable picker window. Its text-input operations targeted
the underlying document instead of the filename field, so UI recovery stopped to preserve
the user's document. No MCP configuration or stable relay was changed.

No fresh live `create_image`, redirect, blocked-address or editor-refusal result is claimed.
The live gate remains open: relaunch the exact 0.8.1 Dev plugin, exercise remote image
success and refusals through the follower, inspect an image node through a node-addressed
follower call, and record the candidate SHA/build and results before opening a PR.
