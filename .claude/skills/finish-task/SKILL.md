---
name: finish-task
description: Use before the last commit of any task in figma-design-relay — refreshes the facts in CLAUDE.md, README and the plans that drift with the code, bumps the version, verifies, has a separate agent review the diff, merges the branch into dev and main, then tears down its dev slot.
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

**No merge into `dev` or `main` happens before this step passes.** The review must cover exactly
what step 5 will merge, so commit everything, then bring the branch up to date on the feature branch
itself — one merge at a time, so a conflict arrives alone:

```bash
git fetch origin
git merge --no-edit origin/dev    # anything that landed on dev directly
git merge --no-edit origin/main   # ...or on main
git rev-parse origin/dev origin/main   # note these: they are what the review covers
```

If that brought something in, re-run steps 1–3 (a release that landed on `main` may clash with this
task's bump). Then spawn a fresh agent (the Agent tool — never review your own work and call it
done) to do a full code review of `git diff origin/dev...<branch>`. Give it the branch name, what
the task set out to do, and ask for
correctness bugs, missed wiring (the `add-mcp-tool` checklist, when a tool changed), stale docs,
and violations of CLAUDE.md's rules — ranked by severity, with file and line.

Then act on it:

- Fix every real finding in a new commit and re-run steps 1–2. Every fix commit gets its own
  review by a separate agent (scoped to those commits) before merging — the author does not get to
  judge a fix too small to need one.
- Push back on a finding that is wrong, with the reason — do not change code just to satisfy it.
- Tell the user what the review found and what happened to each item, then carry on to step 5. The
  user does not need to approve the merge unless a finding needs their decision.

## 5. Merge: feature → dev → main

Real merges only — no rebase, no squash — so the branches keep sharing history. Each push runs CI.
Run this step **from the main checkout**, not the feature worktree: `main` is checked out there, and
git will not switch a second worktree to it. Worktrees share branches, so `<branch>` is there
already. Start with `git fetch origin`: if `origin/dev` or `origin/main` is not at the commit noted in step
4, go back to step 4 — what arrived has not been reviewed. Likewise if local `dev` or `main` holds
commits the remote does not (`git log origin/dev..dev`, `git log origin/main..main` must be empty).

```bash
git switch dev && git pull --ff-only && git merge --no-edit <branch> && git push origin dev
git switch main && git pull --ff-only && git merge --no-edit dev && git push origin main
```

`dev` and `main` now point at the same commit. If the task bumped the version, tag that commit and
push the tag **by name**: `git tag vX.Y.Z && git push origin vX.Y.Z` — never `git push --tags`.

## 6. Tear down the dev slot

A task built in a feature worktree ends by removing its slot — the Dev plugin import in Figma, its
MCP entry, then the worktree and branch — and rebuilding the main checkout so the stable plugin
carries the change. The `start-feature` skill's step 4 has the commands. Ask the user to remove the
Figma import and to confirm before you edit their MCP config.
