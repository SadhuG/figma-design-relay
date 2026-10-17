# Upstream relay integration — verification record (0.7.9)

The 0.7.9 integration of upstream `gethopp/figma-mcp-bridge` through v0.0.24 (`2c37e6d`): what was
merged, how it was checked automatically, and what was checked against real Figma. Spec:
[`../superpowers/specs/2026-10-18-upstream-relay-audit-design.md`](../superpowers/specs/2026-10-18-upstream-relay-audit-design.md).
Plan: [`../superpowers/plans/2026-10-18-upstream-relay.md`](../superpowers/plans/2026-10-18-upstream-relay.md).

## Candidate

- Branch `feat/upstream-relay-oct18`, from relay `55bd5ea` (0.7.8). The integration is a real merge
  with upstream `2c37e6d` as its second parent; red regression contracts were committed first.
- Dev slot `upstream-relay-oct18`, port 1998; Dev plugin "Figma Design Relay (Dev:
  upstream-relay-oct18, port 1998)", id `figma-design-relay-dev-upstream-relay-oct18`. The stable
  manifest keeps `[figma, figjam, slides]`.
- 64 MCP tools (54 before): `get_prototype_connections`, `trace_prototype_flow`, `create_svg`,
  `fit_to_content`, `distribute_horizontally`, `distribute_vertically`, `align_to_grid`,
  `place_below`, `place_right_of`, `duplicate_with_offset`.

## Automated verification

Run on the resolved candidate before the merge commit, Bun 1.4.0, Windows 11:

| Check                                      | Result                                 |
| ------------------------------------------ | -------------------------------------- |
| `bun run check` (root)                     | exit 0                                 |
| `bun scripts/check-version.mjs`            | `0.7.9`                                |
| server `bun test`                          | 384 pass, 2 skipped on Windows, 0 fail |
| plugin `bun test`                          | 322 pass, 0 fail                       |
| plugin `bun run typecheck`                 | zero errors                            |
| server and plugin builds                   | pass                                   |
| `bun run format:check`, `prettier docs/**` | pass                                   |
| `git diff --check`                         | clean                                  |
| old-name grep over `plugin` and `server`   | no hits                                |

Baseline before any change (`55bd5ea`): server 327 pass / 2 skip, plugin 218 pass, all checks green.

## Live Figma checks

Pending — recorded below once run against the merged candidate's build.
