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
      `read-progress.ts`), bump to **0.10.0** (0.9.0 went to the relay dashboard, which reached `dev` first) with a CHANGELOG entry, `bun scripts/check-version.mjs`,
      format, all tests and builds.
- [x] **5. Review:** GPT-6.1-Sol reviewed the full branch diff against `origin/dev`; findings
      were fixed, re-verified and re-reviewed until satisfied. Affected live checks are recorded
      in [live-check.md](live-check.md).
- [x] **6. PR feature → `dev`:** [PR #22](https://github.com/SadhuG/figma-design-relay/pull/22)
      recorded the review rounds and live checks, passed CodeRabbit review and CI, and merged
      into `dev` as `996db70`.
- [ ] **7. `dev` → `main` gate:** [PR #23](https://github.com/SadhuG/figma-design-relay/pull/23)
      needs its own GPT-6.1-Sol review, CodeRabbit review and required checks on the actual latest
      diff before handoff. The user merges it. Keep phase 5 in progress until this gate passes,
      then update the overview status.

## Acceptance

PR merged into `dev` with reviews and live-check recorded; `dev` → `main` PR open.
