---
paths:
  - "docs/**"
---

# Docs rules

`docs/README.md` maps the folders: `guides/` and `reference/` are user-facing, `superpowers/` is the
design history (specs + plans, each markdown with a rendered HTML twin). `docs/superpowers/README.md`
holds the plan-set table, the open live checks and how to execute a plan.

## The HTML pages

- **The markdown is the source of truth.** It is what executor agents read.
- Pages for **phases 2–6 are generated**: `node docs/superpowers/_src/build-plans.mjs`. Never
  hand-edit them — edit the markdown and rebuild. A new generated plan needs an entry in the
  script's `PLANS` array and a card in `docs/superpowers/index.html`.
- The **phase 1 page, the spec page and `index.html` are hand-authored** and not in the generator's
  list. Edit them directly.
- The generator expects a strict shape: `### Task N: Name [R1, R2]`, `**Files:**`,
  `**Interfaces:**`, `- [ ] **Step N: …**`, `Run:` / `Expected:` lines. Run Prettier on the markdown
  **before** regenerating — Prettier reflows lists and the parser reads the reflowed shape — then
  format the HTML.
- **Checkbox state carries through.** `- [x]` renders pre-checked; `doc.js` derives the per-task
  progress. Mark progress in the markdown and rebuild, never in the HTML. Confirm the reported step
  count matches the markdown — a suspiciously low count means steps were dropped.

## Moving or renaming a doc

Links to docs live in `README.md`, `CHANGELOG.md`, the plans, the spec, the HTML pages and
`build-plans.mjs`. After a move, `git grep` the old path until nothing matches; relative links
inside moved files (`../reference/…`, `../../plugin/…`) need their depth fixed too.

## After any docs change

`bun run format`, then `bunx prettier --check "docs/**/*"`. Docs-only commits use `docs:` and do
not bump the version.
