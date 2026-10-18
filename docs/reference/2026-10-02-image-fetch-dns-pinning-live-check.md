# Remote image fetches pin their validated DNS answer: live Figma verification

Checked on 2026-10-02 on branch `fix/image-fetch-dns-pinning`, for the DNS-rebinding finding left
open by the [0.7.8 project review](2026-10-01-project-review.md). The change is server-only: it
moves `create_image`'s remote fetch into `server/src/image-fetch.ts`, where the socket may connect
only to the addresses that passed the private-address check.

## Tested build

- Server built from `a6f0b20`, the commit carrying the change. `server/dist/image-fetch.js`
  `96CCE683…1723C96` and `server/dist/tools.js` `AE39EFC6…9DC233E9` (SHA-256); a rebuild from the
  committed source reproduced both hashes.
- The plugin source is unchanged from `main`. This worktree's `plugin/dist/code.js`
  (`B6A515B0…E334486D6C`) and `index.html` (`034E9F11…AE302FFA`) are byte-identical to the build
  recorded in the 0.7.8 review, which was still running in the open files.

## Setup

- Worktree `figma-design-relay-image-fetch-dns-pinning` on dev slot port 1995, with
  `node .smoke/hold-leader.mjs` holding the leader on `127.0.0.1:1995` from this worktree's `dist`.
- Four files connected (`list_files`): **Screen** and **DS** (Design), an **Untitled** FigJam board
  and an **Untitled** Slides deck.
- Every case ran through `node .smoke/call.mjs` as a follower. The `create_image` handler, and so
  the fetch, runs in the follower's process; the result then crosses `/rpc` and the WebSocket.

## Results

All Design cases ran in **Screen**, on a scratch page that was removed afterwards.

| Case                       | Source                                                | Result                                                                                             |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| HTTPS image                | `https://www.google.com/images/branding/…_92x30.png`  | Created a 92×30 IMAGE fill, hash `b7a1bff0…`. SNI and certificate checks pass through the pinning. |
| Cross-host HTTPS redirect  | `https://github.com/github.png?size=40`               | Followed to `avatars.githubusercontent.com`; created a 40×40 IMAGE fill, hash `9b6d97fc…`.         |
| Hostname → loopback        | `http://localtest.me/x.png`                           | `isError: true`, "resolves to a blocked internal address"; nothing sent to Figma.                  |
| Hostname → loopback relay  | `http://127.0.0.1.nip.io:1995/ping`                   | Refused the same way.                                                                              |
| Cloud metadata literal     | `http://169.254.169.254/latest/meta-data/`            | Refused the same way.                                                                              |
| Public redirect → loopback | `https://httpbin.org/redirect-to?url=…127.0.0.1:1995` | First hop fetched, second hop refused the same way.                                                |
| FigJam                     | HTTPS image, FigJam board                             | `isError: true`, "create_image requires design editor": the capability refusal is unchanged.       |

Before shipping, the built module was also run under Node 24.20 (the production runtime; the test
suite runs under Bun). There it connected with a single lookup and the original `Host` header,
downloaded a real HTTPS PNG, and refused `wrong.host.badssl.com` with
`ERR_TLS_CERT_ALTNAME_INVALID`.

## Not run live

- **A real rebinding hostname.** `7f000001.08080808.rbndr.us` returned `EAI_AGAIN` on every lookup
  from this network. `image-fetch.test.ts` covers the case with a resolver that answers public, then
  internal: the fetch resolves once and connects only to the first answer.
- **Slides** has no `create_image` support (design editor only), the same as FigJam.
