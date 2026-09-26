# Specs and plans

Design history for Figma Design Relay: the specs that decided what to build and the plans that built
it. Every document is markdown with a rendered HTML page beside it — the markdown is what executor
agents read and is the source of truth; open [`index.html`](index.html) to read them as people do.

```
specs/   what and why — numbered requirements, decision records
plans/   how — task-by-task TDD plans, one per phase, each citing the requirements it satisfies
assets/  doc.css + doc.js, shared by every HTML page
_src/    build-plans.mjs, which renders the phase 2–6 plan pages from their markdown
```

New specs and plans go in the same folders, named `YYYY-MM-DD-<slug>.md`. Plans that belong to a
numbered programme carry the phase in the slug (`2026-09-01-phase-3-design-context-v2.md`) so the
folder lists in build order. How to regenerate and format the pages lives in
[`.claude/rules/docs.md`](../../.claude/rules/docs.md).

## The official-MCP parity programme — delivered

[`specs/2026-09-01-official-figma-mcp-parity.md`](specs/2026-09-01-official-figma-mcp-parity.md)
measured the gap to Figma's own MCP server and wrote it down as 55 numbered requirements (R1–R55).
Six plans closed it. R51–R55 are cross-cutting and bind every tool any phase added — and every tool
added since.

| Phase | Plan (`plans/2026-09-01-…`)         | Reqs    | Tasks | Depended on          | Shipped in |
| ----- | ----------------------------------- | ------- | ----- | -------------------- | ---------- |
| 1     | `phase-1-run-script.md`             | R1–R10  | 7     | —                    | 0.2.0      |
| 2     | `phase-2-serializer-enrichment.md`  | R11–R19 | 6     | phase 1 test harness | 0.3.0      |
| 3     | `phase-3-design-context-v2.md`      | R20–R27 | 7     | phase 2 (R14, R15)   | 0.4.0      |
| 4     | `phase-4-code-connect.md`           | R28–R35 | 8     | phase 2 (R13)        | 0.5.0      |
| 5     | `phase-5-library-reach.md`          | R36–R42 | 7     | phase 1 test harness | 0.6.0      |
| 6     | `phase-6-figjam-slides-diagrams.md` | R43–R50 | 8     | phase 1 test harness | 0.7.0      |

Phases 3 and 4 depended on phase 2 for real, not by preference: without resolved token and style
names phase 3 could not emit `var(--token)`, and without component property definitions phase 4
could not author accurate mappings.

### Live checks still open

Every task's code, tests and commit are done. These steps stay unchecked because they need a Figma
setup that was not available when the phase finished; tick them in the markdown (and rebuild) once
they have been run.

| Plan    | Step                                                             | Needs                                   |
| ------- | ---------------------------------------------------------------- | --------------------------------------- |
| phase 5 | Task 5, step 6 — import a published component by key             | a file with a published library enabled |
| phase 5 | Task 7, step 2 — run the library tools on a capable plan         | an Organization or Enterprise plan      |
| phase 6 | Task 2, steps 5–6 — connect in FigJam/Slides, refusal path       | a FigJam board and a Slides deck        |
| phase 6 | Task 3, step 6 — stickies and a connector through `get_document` | a FigJam board                          |
| phase 6 | Task 4, step 6 — create and connect shapes-with-text             | a FigJam board                          |
| phase 6 | Task 7, step 7 — `generate_diagram` on a real board              | a FigJam board                          |

## Executing a plan

1. Read the phase's requirement block in the spec, then the plan's **markdown** — not the HTML.
2. Work tasks in order. Each is a full TDD cycle: failing test → run it and see it fail → minimal
   implementation → run it and see it pass → commit.
3. **Run the failing-test step and actually look at the failure.** A test that passes before the
   implementation exists is testing nothing.
4. One commit per task, using the message the plan gives.
5. A task's **Interfaces / Produces** block is the contract later tasks were written against. If
   you change a name there, grep for it in the later tasks of the same plan.
6. Tick each step (`- [x]`) as it lands and rebuild the page, so the rendered progress stays true.

Drive it with `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

## Other specs

- [`specs/2026-09-02-figma-design-relay-name-change.md`](specs/2026-09-02-figma-design-relay-name-change.md)
  — the rename from "Figma MCP Bridge" and the canonical naming table.
