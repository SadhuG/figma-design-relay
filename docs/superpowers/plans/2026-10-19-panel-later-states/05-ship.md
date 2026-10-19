# Phase 5: Ship

[← Overview](00-overview.md)

**Goal:** Prove it in Figma, record it, get it reviewed and land it in `dev`. **Out:** merging
`dev` → `main` (the user does that).

## Tasks

- [x] **1. Live check** (`live-figma-check` skill) on the Dev plugin, port 1995, relay held with
      `hold-leader.mjs`, Figma window driven from PowerShell. Record in `live-check.md` beside this
      file: commit, setup, each case and its result.
  - 04: `call.mjs get_selection` with 3 nodes selected → working, then Sent + "3 nodes · sent just
    now"; Show in canvas zooms; changing the selection drops the suffix; Sent leaves ~10 s later.
  - 05: `get_document` on a large page (build a page of ~3,000 layers with `probe.mjs`, delete after)
    → purple percent rising; normal working chip for a small read.
  - 06 (FigJam board): `generate_diagram` → red chip + Select it; Select it selects and zooms;
    another call clears it.
  - 08: a second process holding a follower (a probe that stays alive) → `Leader · 1 follower`;
    gone within ~60 s of it exiting. Collapsed texts for each state.
  - Regression: Live, working, lost/Retry now, collapse/expand.
- [x] **2. Board 10.** Change the four cards' `LATER` tags to `BUILT`, replace each open question
      with the decision made, retitle the section, and fix any text the live check changed.
- [x] **3. Repo rule.** CLAUDE.md Workflow and `.claude/skills/finish-task`: the independent
      review is a GPT-6.1-Sol agent through T3 `delegate_task` (`codex`, `gpt-6.1-sol`), re-run
      until satisfied; the agent merges feature → `dev` and opens `dev` → `main` for the user.
- [x] **4. finish-task:** refresh CLAUDE.md facts (test counts, layout: `followers.ts`,
      `read-progress.ts`), bump to **0.9.0** with a CHANGELOG entry, `bun scripts/check-version.mjs`,
      format, all tests and builds.
- [ ] **5. Review:** GPT-6.1-Sol on the full branch diff against `origin/dev`; fix, re-verify,
      re-review until satisfied. Rerun affected live checks if the plugin or server changed.
- [ ] **6. PR** feature → `dev` with the review rounds and live-check record; CodeRabbit review and
      CI green; merge (merge commit). Open or update `dev` → `main`. Update overview statuses.

## Acceptance

PR merged into `dev` with reviews and live-check recorded; `dev` → `main` PR open.
