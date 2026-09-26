---
name: sync-upstream
description: Use when pulling changes from the upstream gethopp/figma-mcp-bridge repository into the figma-design-relay fork, or resolving conflicts from such a merge.
---

# Syncing with upstream

This repo forks `gethopp/figma-mcp-bridge`, wired up as the `upstream` remote with its push URL set
to `DISABLED` so nothing can be pushed there by accident.

1. Branch: `git switch -c chore/sync-upstream-<date>` from `dev`.
2. `git fetch upstream && git merge upstream/main` — **a merge, never a cherry-pick or squash**, so
   the next sync's merge base stays correct and the same commit never conflicts twice.
3. Resolve conflicts. They are almost always re-indentation colliding with a renamed string, not a
   real disagreement: **take upstream's structure and keep this fork's names** (the naming table in
   CLAUDE.md is not negotiable).
4. Hunt for old names that auto-merged back in:
   ```bash
   git grep -n "figma-mcp-bridge\|FIGMA_BRIDGE\|Figma MCP Bridge" -- plugin server
   ```
5. Upstream does not run this Prettier config; the Husky hook formats what you stage, or run
   `bun run format`.
6. Verify locally — `bun run typecheck` and `bun test` in `plugin/`, `bun test` in `server/`, and a
   build of each. **A non-zero plugin type-check count means the merge broke something**; do not
   wave it through.
7. Finish with the `finish-task` skill (patch bump, a full review by a separate agent, then merge
   to `dev` then `main`). The review covers everything upstream brought in, not just the conflict
   resolutions: upstream's code has never been reviewed against this fork's rules (loopback-only
   binding, no old names, no npm publishing).
