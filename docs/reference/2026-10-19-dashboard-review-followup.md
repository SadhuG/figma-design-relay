# Dashboard review follow-up verification — 2026-10-19

Candidate: `fix/dashboard-review-followup`, based on `891566dd7a23c28a5b9abe37d789b0173a111600`.
Package versions are 0.9.1; the existing relay process still reports its startup version 0.9.0.
Only dashboard CSS, documentation and package version metadata changed.

## Browser and contrast verification

T3 `preview_status`, `preview_open` and `preview_snapshot` reached the existing relay at
`http://127.0.0.1:1996/`, leader process 10032. No relay restart was needed: it serves the CSS
directly from this worktree. The on-disk and HTTP-served CSS SHA-256 hashes both equal
`6CF803F4F7E50EC7F0C7780266A6F5388BE17D3A5BA27F58F65BB12B8F898BEE`.

Before the fix, computed light-theme success and failure text contrasts were 2.9011:1 and
3.6678:1. After refreshing the page, actual computed foreground/background colors give:

| Theme | Element        | Foreground | Background | Contrast |
| ----- | -------------- | ---------- | ---------- | -------- |
| Light | Success result | `#08783e`  | `#ffffff`  | 5.5755:1 |
| Light | Failure result | `#c93416`  | `#ffffff`  | 5.2681:1 |
| Light | Offline banner | `#ffffff`  | `#a32b16`  | 7.2055:1 |
| Dark  | Success result | `#53d68a`  | `#2c2c2c`  | 7.5501:1 |
| Dark  | Failure result | `#ff947e`  | `#2c2c2c`  | 6.5099:1 |
| Dark  | Offline banner | `#ffffff`  | `#812714`  | 9.4013:1 |

Ratios use sRGB linearization, relative luminance and `(Llighter + 0.05) / (Ldarker + 0.05)`.
All unrounded results exceed the normal-text 4.5:1 threshold in
[WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Status cells inherit their section's panel background in both themes.

To show the offline state without interrupting the relay or Figma, this browser tab temporarily
rejected only its `/api/status` fetch. The real polling catch handler exposed the banner while
preserving existing success/error rows. T3 appearance emulation covered light and dark; screenshots
were visually inspected for readable text and intact layout. The original fetch function was
restored afterwards, and successful polling hid the banner again.

- [Light status rows and offline banner](assets/relay-dashboard-review-2026-10-19/light.png)
- [Dark status rows and offline banner](assets/relay-dashboard-review-2026-10-19/dark.png)

## Documentation and checks

The activity plan now preserves optional `agent` as argument five and defaults optional `origin`
as argument six in its prose, interface, test sample, implementation signature and RPC instructions.
The dashboard Quick Start uses the leader's literal IPv4 listening address.

Focused dashboard rendering, HTTP, activity and bridge tests: **43 passed, 0 failed**.
Server TypeScript build and plugin no-emit type check both passed. Version agreement, changed-file
and documentation Prettier checks, and `git diff --check` passed.

The full root `bun run check` also passed: server **450 passed, 2 Windows skips, 0 failed**
(452 tests across 31 files); plugin **381 passed, 0 failed** (23 files); version agreement,
server and plugin builds, plugin type check and repository formatting passed. Raw output is kept
locally in the ignored `dashboard-followup-check.log`. The plugin build updated its local version
metadata; no plugin implementation changed, and the CSS screenshots above used the unchanged
running relay process.

No Figma dispatch, schema, tool or plugin UI implementation changed, so the prior live editor
matrix remains relevant; this follow-up verifies the changed browser CSS directly.

## Subsequent follower telemetry review fix

The architecture concern in [promotion review #23](https://github.com/SadhuG/figma-design-relay/pull/23#issuecomment-6260097799)
was confirmed: distinct numeric heartbeat labels grew an uncapped map, and expiry previously ran
only when a dashboard snapshot was read. The follow-up now caps this display-only registry at
**256 labels**, enough for far more concurrent local AI sessions than a typical workstation.
Each heartbeat or RPC observation (including an unidentified heartbeat) prunes labels silent for
over 60 seconds. Observations refresh map insertion order; the least recently observed label is
evicted at capacity, with observation order breaking clock ties. Normal active labels retain their
call counts. Eviction never affects routing or authorization. No timer was added: expiry is
opportunistic, so an idle relay retains at most 256 labels until another observation or status read.

Three fake-clock regressions failed before the implementation: 300 entries instead of 256; an
expired returning label retaining its old call count; and a refreshed label not protected by
eviction. All three pass after the change, along with the existing normal counting/expiry tests.
Full root `bun run check` passed: server **453 passed, 2 Windows skips, 0 failed** (455 tests,
31 files); plugin **381 passed, 0 failed** (23 files), both builds, type check, version and format
checks. Raw output remains in the ignored `dashboard-telemetry-check.log`.

For fresh live checks, the old worktree holder 37380 and child 10032 were stopped after verifying
their command lines and port. A rebuilt holder 43808 started leader **27224 on 127.0.0.1:1996**,
version 0.9.1. Its compiled `server/dist/activity.js` SHA-256 was
`6F53646F74CAC5FC115E2B270D7864A3049B0CDCC3196251D71E33625F350F55`.
The existing Slides plugin automatically reconnected as `unsaved-mvet24rj-1qquzuq1`; no Figma UI
or MCP configuration was changed. The stable port was not operated on.

- 300 HTTP `GET /ping` requests with distinct labels `900000` through `900299` returned success.
  The next snapshot showed exactly **256** followers: `900000` was evicted and `900299` remained.
- The synthetic labels were not refreshed. More than 60 seconds later, a new heartbeat and status
  read showed **zero** remaining synthetic labels, alongside recent real follower labels.
- Real MCP follower **25072** called `get_selection` through the rebuilt leader and returned
  `isError: false`, including selected slide `1:42`. Dashboard activity retained its follower
  origin, successful outcome and call count **1** (32.727-second plugin response).
- Real MCP follower **37424** called `get_node` with `nodeId: "1:42"` and the explicit Slides file
  key. It returned `isError: false` and the requested slide, while its telemetry count was **1**.
  An earlier probe incorrectly supplied the MCP argument `nodeIds`; schema validation rejected
  that probe before forwarding. The corrected probe above passed.

The CSS verification above remains applicable because this subsequent fix changes only registry
retention. The earlier release dry run on `5dc8a234` predates this runtime fix and does not verify
its compiled artifact. The new commit still belongs to the pending 0.9.1 follow-up release.
