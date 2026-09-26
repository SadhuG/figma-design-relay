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

### What is not implemented, and when it can be

Audited on 2026-09-26 against the code, not just the checkboxes. Every task in all six plans has its
code, tests and commit; 285 of 290 plan steps are ticked. What remains falls into four groups.

#### 1. Requirements delivered short of the spec

Two requirements shipped narrower than written. 0.7.2 closed one and most of the other; what is left
is one piece of R40.

| Req | The spec asks for                                                                                                                                     | Status                                                                                                                                                                                                                                                                                                                                               | When                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R25 | `get_design_context` hints in the order Code Connect → **component description** → **annotation** → token → raw value, with the source named per node | **Delivered in 0.7.2.** Phase 3 had wired only the sources in the codegen's `SerializedNode` type, and no test asserted the two missing tiers. The plugin now serializes `mainComponent.description` (the variant's, else its set's), and React and HTML output emit `component description:` and `annotation:` comments at their rank.              | Done. Unit-tested; not yet seen in a live file (section 2).                                                                                                                                           |
| R40 | `search_design_system` covers library variable collections and components "present or instantiated in the connected files"                            | **Every page of one file, since 0.7.2**, with opt-in `allPages: true` (it calls `figma.loadAllPagesAsync()` first, which is slow on large files, so the default stays on the current page). **Not delivered: searching several connected files in one call** — the agent routes one file at a time with `fileKey`, and the tool description says so. | **When a user needs it.** Fanning out needs server-side aggregation no tool does today, plus decisions on which file a result's id belongs to and how a partial failure reads. It wants its own spec. |

#### 2. Live checks still open

The code and unit tests for these are done; they have not been run against real Figma yet.

| Change | Check                                                                     | Needs                                                                          |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 0.7.2  | R25 hints in `get_design_context`; `search_design_system` with `allPages` | a design file with an annotated, described component instance on a second page |

**When:** now. Nothing external blocks it; it needs one session with such a file open, driven by
the `live-figma-check` skill.

Phase 6's live checks — connecting in FigJam and Slides, the cross-editor refusals, stickies and
connectors, shapes with text, and `generate_diagram` — all passed on 2026-09-27. That first run
found two connector bugs no unit test had caught; 0.7.3 fixed both.

#### 3. Verified differently, and blocked on a paid plan

These steps are ticked but marked **done differently** in their plans. Unit tests stand in for the
live run because the live run needs something this project does not have.

| Plan    | What was never run live                                                                                                 | Blocked on                                                           | When                                                                                                                                                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| phase 5 | Real `get_libraries` data, a successful `import_library_asset`, a `search_design_system` hit through a library instance | a Figma plan that allows team library APIs, with a published library | When an account on such a plan is available, or a user on one reports what Figma returned. `docs/guides/libraries.md` ("What has been verified against real Figma") tells users this.                                                                             |
| phase 1 | R7 — `run_script` refused in Dev Mode, seen in real Dev Mode                                                            | a paid Dev seat, and now the manifest                                | **Not while FigJam is supported.** R43's amendment dropped `dev` from `editorType`, because Figma refuses a plugin that declares both `dev` and `figjam`. The gate and its tests remain, so restoring `dev` is one manifest line if Figma lifts that restriction. |

#### 4. Out of scope by design

Not deferred work — the spec decided against these, and the user-facing docs say so.

| Official tool or behaviour   | Why the relay does not have it                                                                                                                                                                             | Could it change?                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `create_new_file`            | The Plugin API cannot create documents (spec Gap 7). `create_page` works inside an open file.                                                                                                              | Only if Figma adds the API.                                                                                                |
| Acting on a file by URL      | The plugin must be open in the target file; `list_files` shows which are (Gap 7).                                                                                                                          | No — it is the architecture. The rate-limit-free design depends on it.                                                     |
| `branchKey` addressing       | Not implemented (Gap 7). A branch opened with the plugin running connects like any other file, under its own key.                                                                                          | Could be investigated if branches become a real workflow; there is no user-facing note on it today.                        |
| `generate_figma_design`      | A Figma-hosted generative model (Gap 7). `import_html_layers` covers an overlapping need.                                                                                                                  | No.                                                                                                                        |
| Atomic `run_script`          | The Plugin API has no rollback (Gap 7). Documented in `docs/guides/run-script.md`.                                                                                                                         | Only if Figma adds transactions.                                                                                           |
| `send_code_connect_mappings` | R34: mappings are workspace files under version control; committing is the publish step. Documented in `docs/guides/code-connect.md`.                                                                      | No — by design.                                                                                                            |
| Creating slide structure     | R47 scoped Slides to read, screenshot and text edits in existing slides. Documented in `docs/guides/slides.md`.                                                                                            | Yes — a future phase; the phase 6 Slides checks passed in 0.7.3. `run_script` can already do it.                           |
| `upload_assets`              | The spec lists it among the official tools but never assigns it a requirement. `create_image` places a local file, URL or data URI as an image fill, and R24 exports assets to disk rather than uploading. | Worth an explicit decision in the spec if a user asks for it; today its absence is unexplained anywhere a user would look. |

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
