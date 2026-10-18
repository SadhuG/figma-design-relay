# DNS pinning integration verification

The DNS pinning branch was integrated with `origin/dev` (`1a8af14`) and then
`origin/main` (`cd2b6ed`) on 2026-10-18. Integration commit: `752bcef`. The release
candidate updates both package versions to 0.8.1. The earlier
[October 2 report](2026-10-02-image-fetch-dns-pinning-live-check.md) describes the old build;
it does not verify this integrated candidate. The fresh live results below verify code
commit `7099a7b6679c80b555355b057227849a178d7583` with the built hashes recorded here.

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

## Live Figma verification

After the user imported and launched the worktree's `plugin/dist/manifest.json`, a
persistent leader from its `server/dist/index.js` listened on `127.0.0.1:1995` (dev
slot `image-fetch-dns-pinning`). `list_files` returned **Figma Design Relay**, editor
`figma`, session key `unsaved-mvdwytth-5i4jf8vb`. No rebuild occurred during testing.
All calls used a fresh MCP client/server process as a follower of that leader, the same
wiring as the smoke harness. The remote-fetch handler ran in the follower, then the
resolved image crossed `/rpc` and the plugin WebSocket.

| Case                                                                       | Result                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Google HTTPS PNG                                                           | Created `43:1228`, 272 × 92, IMAGE fill hash `1737d3dfb411c07b86ed8bd30f5987a4dc397cc1`.                   |
| `https://github.com/github.png?size=40` cross-host redirect                | Created `43:1229`, 40 × 40, IMAGE fill hash `9b6d97fc395aca41fd08357cb6350b8d7c9379dd`.                    |
| `http://localtest.me/x.png`                                                | `isError: true`, blocked internal address.                                                                 |
| `http://127.0.0.1.nip.io:1995/ping`                                        | `isError: true`, blocked internal address.                                                                 |
| `http://169.254.169.254/latest/meta-data/`                                 | `isError: true`, blocked internal address.                                                                 |
| `https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%3A1995%2Fping` | `isError: true`, blocked internal address on the redirect target.                                          |
| `https://wrong.host.badssl.com/`                                           | `isError: true`, certificate hostname mismatch.                                                            |
| Node-addressed follower `get_node`                                         | Returned scratch frame `43:1227` and both image children with their exact IDs, dimensions and IMAGE fills. |

The scratch frame was placed at `(100000, 100000)` on the existing page. Cleanup
`run_script` removed `43:1227` and its children and restored the original empty selection;
its response confirmed success. An initial harness attempt misread the `run_script`
result wrapper; its three scratch nodes `43:1224`–`43:1226` were explicitly removed
before the successful run. No user nodes were removed. A separate post-cleanup lookup of
those removed IDs returned Figma's network error after 10 seconds; the cleanup call itself
had already succeeded.

This feature changes server-side remote fetching; the editor capability table is unchanged.
Design is the editor that supports `create_image`. No new FigJam, Slides or paid-editor
success path is introduced. A real rebinding hostname is covered by deterministic resolver
tests rather than claimed as a live network case.

## Resolved setup blocker

Earlier, all relays listed no files, and Figma showed plugin-environment and reconnect
errors. The available Computer Use surface could not target the native manifest picker,
so automation stopped. The old 1995 leader also exited. Restarting a persistent leader
and the user's import/launch resolved the blocker. No MCP configuration or stable relay
was changed.
