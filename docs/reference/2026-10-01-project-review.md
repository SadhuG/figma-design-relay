# Project review and cleanup — 2026-10-01

Base: `origin/main` at `ba5b62a`. `git pull --ff-only origin main` reported already up to date.
Candidate: `chore/project-cleanup`, in `C:/Users/sadhu/code/figma-design-relay-cleanup`.
The original checkout's three pre-existing lockfile metadata changes were preserved.

## Scope

Reviewed server transport, leader election, MCP handlers and schemas, filesystem access,
code generation, Code Connect, cross-file search and Mermaid parsing/layout; plugin dispatch,
serialization, editor capabilities, scripts, libraries, HTML import and UI connection lifecycle;
and package scripts, build configurations, CI/release workflows and documentation.
Separate agents reviewed the server and plugin, and a fresh reviewer reviewed the cleanup diff.
This is a source review with automated integration tests, not a complete security audit.

## Findings addressed

| Priority | Finding                                                                                  | Change and evidence                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | A plugin could resolve another file's request by returning its request ID.               | The bridge checks the responding socket against the pending request; a two-socket integration test rejects the forged response.                                                             |
| P1       | Local image reads and screenshot writes followed directory links outside the workspace.  | Shared containment checks resolve existing ancestors before access, and screenshot writes recheck after waiting for the plugin. Junction tests confirm no external directories are created. |
| P1       | Asset exports validated the directory but followed links at the final filename.          | The final asset path is validated before writing. A junction test exercises that boundary; an external file-symlink test runs on non-Windows systems.                                       |
| P1       | IPv4-mapped IPv6 URLs bypassed private-address checks.                                   | Mapped hexadecimal addresses are decoded before the IPv4 policy applies. Loopback/private URL regressions pass.                                                                             |
| P1       | IPv6 link-local URLs did not match the blocked-address pattern.                          | The pattern now matches `fe80::/10`; a URL regression exercises `fe80::1`.                                                                                                                  |
| P2       | Failed leader startup leaked a heartbeat interval on every attempt.                      | Failed candidates are stopped; three failed binds leave no surviving heartbeat timers.                                                                                                      |
| P2       | The image-fetch deadline expired after headers rather than after the body.               | The cancellation timer remains active during body consumption. A stalled stream fails within the 15-second deadline. Redirect/error bodies are cancelled.                                   |
| P2       | HTML reference output contained self-closing nonvoid elements.                           | Empty containers/components receive explicit closing tags; image tags remain void.                                                                                                          |
| P2       | Designer names and asset paths could break generated quoted attributes and JSX comments. | Asset src/alt text escapes quotes and entities; component, text-style and mapping hints sanitize comment terminators.                                                                       |
| P2       | `get_node` serialized unloaded page children.                                            | Page nodes are loaded asynchronously before serialization; the dispatcher regression uses an unloaded-page fixture.                                                                         |
| P2       | The UI could miss initial file status and stay disconnected.                             | The mount-time UI-state request returns file status as well as collapse state.                                                                                                              |
| P2       | HTML rectangle imports assigned image paints before normalizing their bytes.             | Image bytes become `Uint8Array`, and image hashes are generated before assigning fills.                                                                                                     |
| P2       | Malformed plugin responses could consume a pending request.                              | Invalid response shapes are ignored, leaving a subsequent valid response able to resolve it.                                                                                                |
| P3       | Paths such as `..icons` were rejected despite remaining inside the workspace.            | Containment checks compare path components rather than any prefix of two dots.                                                                                                              |
| P3       | Root `check` omitted tests/version validation and repeated the plugin type-check.        | Root `test` runs both suites; `check` includes it and the version guard, then both builds and formatting.                                                                                   |

The shared workspace helper removes duplicate asset path validation. No dependencies were added.
Known formatter/build warnings caused by the intentional `run_script` eval remain unchanged.

## Remaining review findings

The WebSocket upgrade route accepts arbitrary browser origins. A review harness connected with
`Origin: https://evil.example`. Response ownership is now enforced, but plugin authentication and
origin policy remain open. A blanket Origin rejection could disconnect legitimate Figma iframe
clients; establish the actual desktop/iframe origins and define a pairing policy before changing
this boundary. Loopback binding and `/rpc` browser guards remain in place.

Remote image loading has a pre-existing DNS-rebinding gap (P1): the hostname is resolved during
validation and resolved independently again by `fetch`. A hostname could return a public address
for the validation lookup and an internal address for the subsequent fetch. Literal-IP checks
and redirect checks are now stronger, but this gap requires a transport that pins the validated
DNS address while preserving the HTTP Host and TLS hostname. It remains unresolved in this cleanup.

## Verification and handoff

Baseline: 307 server tests and 215 plugin tests passed; both builds, type-checking and formatting
passed. Each reproduced regression was checked before its fix, except the platform-specific
file-symlink case, which cannot run without additional Windows privileges. The final automated
verification (`bun run check`): 327 server tests passed, 2 Windows-only skips, and 218 plugin tests
passed; version validation (0.7.7), both builds, type-checking and formatting passed. The two skips
cover existing and dangling leaf-file symlinks; directory-junction containment cases ran locally.
The separate reviewer approved the fixes, with DNS rebinding and WebSocket authentication/origin
policy retained as explicit follow-up findings.

## Live verification

The user imported and launched the candidate Dev plugin in four test files: **Screen** and **DS**
(Design), an **Untitled** FigJam board and an **Untitled** Slides deck. The candidate relay listens
on port 1995; probes explicitly joined it as followers. No stable relay was used for these checks.

Tested runtime: cleanup commit `1f9186d`, version 0.7.7. At verification, the branch also contained
`7a33134`, a concurrent change to dev-plugin display names and related documentation/tests;
it did not change the plugin runtime source or server source. Runtime SHA-256 hashes:

| Artifact                 | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `server/dist/tools.js`   | `243B2AD2BD6F33F4CCE2287B6D584768813122BBBDBDAEDD6398E170A59039FB` |
| `plugin/dist/code.js`    | `B6A515B00E72A4880374123BD72F8B14A89C7AF54337960AA0A56FE334486D6C` |
| `plugin/dist/index.html` | `034E9F11177619DB3D1AECE6978582FDF6D3B537B8F9FFFE854F11AFAE302FFA` |

`node .smoke/cleanup-live.mjs` from `server/` passed **13 checks**:

- File-specific metadata, selection and script reads in all four files; editor/name identity matched
  each requested file, exercising multi-file response routing.
- `get_node` for an off-current-page fixture through a follower, including its child frame. The
  user's current page stayed unchanged. This fixture was newly created; cold unloaded-page
  ordering is separately protected by the dispatcher unit test.
- A frame layout-tree request through a follower.
- Local PNG creation produced an actual Figma image hash.
- HTML JSON image-byte import produced two layers, including an image rectangle with a valid hash.
- Screenshot save produced a 446-byte PNG inside the workspace.
- HTML design context returned exported assets, reference code and an image content block.
- External directory links were refused by both image reads and screenshot writes; no external
  directory was created. Screenshot failures use the documented per-item batch result.
- An IPv4-mapped loopback URL was refused before Figma mutation.
- Owned fixture cleanup succeeded. Temporary pages, nodes and local files were removed.

The first harness run incorrectly expected batch screenshot failures to set MCP `isError`.
The API correctly reported `hasErrors` and per-item failure; the harness was corrected to assert
that contract. No production code changed as a result, and the complete rerun passed.

Connection recovery was also observed: the original interactive holder had stopped, leaving
Figma sockets trying port 1995. Starting the candidate holder with hidden `Start-Process` restored
all four connections automatically, without a plugin rebuild or selection change. The background
holder is left running for the user's open Dev plugins.

An intentional stop/restart test was attempted but automatic approval review rejected the process
operation with `blocked by policy`; no process was stopped by that attempt. This report records
the observed recovery, not an intentional restart, and does not claim that UI close/relaunch was
automated. The user manually launched the candidate after its last runtime build.

## Final integration verification

The cleanup branch was merged with `origin/dev` and `origin/main` at
`1155e50d929237f0ea181ccf0fd0cf60db1fc0ce`. Their independent 0.7.7 release is preserved;
the cleanup release is **0.7.8**. Integration changed documentation and package metadata,
without changing the previously tested runtime source.

Final automated verification passed: 327 server tests, 2 Windows leaf-symlink skips,
218 plugin tests, both builds, type-checking, formatting and version validation.
The plugin builds used temporary output directories to preserve the user's running imports.
Both resulting runtime hashes match the table above exactly, as does the rebuilt server
`tools.js`. The user-launched plugin therefore still runs the exact compiled candidate.
The complete 13-case live harness passed again through a newly started follower on port 1995,
with all four editors connected and owned fixtures removed afterward.

The DNS-rebinding and WebSocket pairing/origin findings above remain unresolved follow-ups;
this cleanup does not constitute a complete security audit remediation.
