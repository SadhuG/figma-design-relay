---
name: finish-task
description: Use before the last commit of any task in figma-design-relay — refreshes the facts in CLAUDE.md, README and the plans that drift with the code, bumps the version, verifies, has a separate agent review the diff, then merges the branch into dev and main.
---

# Finishing a task

Nobody has to ask for any of this. A finished branch left stale or unmerged is unfinished work.

## 1. Verify

From the repo root:

```bash
(cd server && bun test && bun run build)
(cd plugin && bun run typecheck && bun test && bun run build)
bun run format:check
bun scripts/check-version.mjs
```

The plugin type-check must report zero errors. Read the `Ran N tests` lines — step 2 needs them.

## 2. Refresh the facts that drift

Some facts describe the code rather than a decision about it, so they go stale with commits nobody
thinks of as docs changes. Check whichever triggers the task touched and fix what moved **in the
task's own last commit**:

| When you…                                               | Re-check                                                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ran `bun test` in either package                        | test counts in CLAUDE.md's Commands table — from the `Ran N tests` line, never an estimate                                                      |
| edited a file named under a Landmarks list              | that landmark's line (`grep -n` the symbol) in `.claude/rules/server.md` or `plugin.md`, and any claim beside it ("awaited at four call sites") |
| added, removed or split a source module                 | CLAUDE.md's Layout tree **and** README's Structure tree                                                                                         |
| added or removed an MCP tool                            | "N MCP tool registrations" in CLAUDE.md's Layout, and README's Available Tools table                                                            |
| added a test file or a new kind of test                 | README's "Tests and type-checking" comments                                                                                                     |
| finished or started a plan step                         | its checkbox in the plan markdown, then rebuild the HTML (`.claude/rules/docs.md`)                                                              |
| finished a phase                                        | the plan-set table in `docs/superpowers/README.md` and the card in `docs/superpowers/index.html`                                                |
| learned something a probe, live check or failure taught | the rule file or skill it belongs in; a surprise that cost time goes in with the symptom first                                                  |

Take every number from a command run in this session. Add as few volatile facts as you can: before
writing one down, ask what a reader would do differently knowing it. If nothing moved, leave the
files alone.

## 3. Bump the version

Unless the task is docs-only: a finished phase bumps the minor, anything else the patch. Update
`server/package.json` and `plugin/package.json` together and add the `CHANGELOG.md` entry in the
same commit (`.claude/rules/release.md`).

## 4. Review by a separate agent

**No merge happens before this step passes.** Commit everything first, then spawn a fresh agent
(the Agent tool — never review your own work and call it done) to do a full code review of
`git diff origin/dev...<branch>`. Give it the branch name, what the task set out to do, and ask for
correctness bugs, missed wiring (the `add-mcp-tool` checklist, when a tool changed), stale docs,
and violations of CLAUDE.md's rules — ranked by severity, with file and line.

Then act on it:

- Fix every real finding in a new commit and re-run step 1. Re-review if the fixes were more than
  small.
- Push back on a finding that is wrong, with the reason — do not change code just to satisfy it.
- Tell the user what the review found and what happened to each item before merging.

If the diff against `dev` changes during step 5 (something new came in from `main`), what came in
has not been reviewed: review that too before pushing it to `main`.

## 5. Merge: feature → dev → main

Real merges only — no rebase, no squash — so the branches keep sharing history. Each push runs CI.

```bash
git switch dev && git pull --ff-only && git merge --no-edit <branch> && git push origin dev
git fetch origin && git merge --no-edit origin/main   # anything that landed on main directly
git push origin dev                                   # only if that brought something in
git switch main && git pull --ff-only && git merge --no-edit dev && git push origin main
```

`dev` and `main` now point at the same commit. If the task bumped the version, tag that commit and
push the tag **by name**: `git tag vX.Y.Z && git push origin vX.Y.Z` — never `git push --tags`.
