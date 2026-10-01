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

The worktree's dev slot is `cleanup` on port 1995. Its generated manifest is
`plugin/dist/manifest.json`. `node server/.smoke/call.mjs list_files`, run from the worktree server
directory, returned `[]`: no candidate Dev plugin was connected. Figma desktop is running, but
the available computer-use interface cannot operate native apps to import/relaunch the candidate.
The stable plugin is a different build and cannot supply candidate verification.

Before PR/merge, import and launch **Figma Design Relay (Dev: cleanup)** from this worktree,
hold its relay using `node .smoke/hold-leader.mjs` in `server/`, and exercise:

- UI startup without changing selection, plus close/relaunch.
- `get_node` for a noncurrent page through a follower; verify the current page stays unchanged.
- An HTML rectangle import with an image byte array; inspect its actual rendered fill.
- Screenshot and asset exports, local image creation, and representative design context output.
- Connection replacement/reconnection and representative read calls in Design, FigJam and Slides.

Live candidate checks are pending. No PR was opened, and nothing was merged or pushed.
The repository's live-check gate requires these checks or an explicit user exception before integration.
