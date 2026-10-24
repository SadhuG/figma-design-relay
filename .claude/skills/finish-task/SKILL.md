---
name: finish-task
description: Use before the last commit of any task in figma-design-relay — refresh facts, bump the version, verify, get a GPT-6.1-Sol review, land the change in dev through a reviewed GitHub PR and open the dev → main PR for the user.
---

# Finishing a task

Prepare this workflow without waiting to be asked. CLAUDE.md's reviewed-PR gate applies to every
change. If review or checks are pending or blocked, leave the PR open and report its status;
finishing a task never authorizes bypassing that gate.

## 1. Verify

From the repo root:

```bash
(cd server && bun test && bun run build)
(cd plugin && bun run typecheck && bun test && bun run build)
bun test ./scripts
bun run format:check
bun scripts/check-version.mjs
```

The plugin type-check must report zero errors. Read the `Ran N tests` lines — step 2 needs them.

For any code that might change behaviour in Figma, run the `live-figma-check` skill against the
exact candidate build before opening a PR or merging. Cover the affected editor(s) and changed
paths, including the follower hop for node-addressed tools, and record evidence in the repository
and PR. Restart/relaunch after rebuilds. Recheck affected paths if later fixes or merges change
the candidate. If a required live check cannot run, stop before opening the PR or merging and
ask the user for an explicit exception with the specific blocker. Automated checks and a note
that a path is unverified do not satisfy this gate. Docs-only changes are exempt.

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

## 4. Review by an independent GPT-6.1-Sol agent

**No merge into `dev` or `main` happens before this step passes.** The review must cover exactly
what step 5 will merge, so commit everything, then bring the branch up to date on the feature branch
itself — one merge at a time, so a conflict arrives alone:

```bash
git fetch origin
git merge --no-edit origin/dev    # changes previously merged through PRs
git merge --no-edit origin/main   # changes previously merged through PRs
git rev-parse origin/dev origin/main   # note these: they are what the review covers
```

If that brought something in, re-run steps 1–3 (a release that landed on `main` may clash with this
task's bump). Then start the review with T3's `delegate_task` (never review your own work, and a
Claude subagent does not count):

- `target: { providerInstanceId: "codex", model: "gpt-6.1-sol" }`, `role: "review"`,
  `mode: "async"`, a `clientRequestId` unique to the round (stable across retries of it).
- The task prompt carries everything, since the reviewer sees no conversation: the worktree path,
  the branch, the base SHA, `git diff origin/dev...<branch>`, what the task set out to do (link
  the plan), and the instruction to review only, not edit. Ask for correctness bugs, missed wiring
  (the `add-mcp-tool` checklist, when a tool changed), stale docs and violations of CLAUDE.md's
  rules, ranked by severity with file and line, and an explicit verdict: satisfied or not.
- Each further round is a **new** `delegate_task` (never `t3_thread_send` to the child thread)
  whose prompt repeats the brief and adds the prior findings, what was done about each, and any
  unresolved objections. Keep going until the reviewer says it is satisfied.

Then act on it:

- Fix every real finding in a new commit and re-run steps 1–2. Every fix commit gets reviewed in
  the next round before merging — the author does not get to judge a fix too small to need one.
- Push back on a finding that is wrong, with the reason — do not change code just to satisfy it.
- Record the review, reviewed head SHA, findings, responses and final approval in the GitHub PR.
  Tell the user what the review found and what happened to each item, then carry on to step 5.
  A local review alone does not satisfy the PR gate.

## 5. Land through reviewed PRs: feature → dev, then open dev → main

Never merge locally and push `dev` or `main`, push directly or force-push to either branch, or use
admin/bypass options. Use GitHub merge commits, not squash or rebase, to preserve shared history.

1. Push only the feature branch and open a GitHub PR targeting `dev`. Include the purpose,
   validation evidence, live Figma results when applicable, and step 4's review record.
2. Request CodeRabbit review when configured and wait for its completed review. Obtain the
   separate reviewer's approval for the latest head SHA, address every finding with fixes or
   documented responses accepted by the reviewer, and wait for required checks to pass. Review
   fix commits and rerun checks. Pending, failed or unavailable review/checks block merging.
3. Fetch again before merging. If the head or target changed, review the resulting diff and
   repeat affected verification, including live checks when applicable. Merge the PR through
   GitHub only when CLAUDE.md's PR gate passes.
4. Open (or update) the `dev` → `main` GitHub PR. Apply the PR gate to its actual latest diff:
   an independent GPT-6.1-Sol review round of that diff, CodeRabbit's review when configured, and
   the required checks. Put that review record and the live-check results in its description, then
   **stop: the user merges it.**
5. Update local checkouts with `git pull --ff-only` after a remote PR merges. The branches may
   have different merge commit SHAs; do not push to make their tips identical. Do not tag: when
   the user merges a `dev` → `main` PR carrying a new version, the Release workflow tags that
   commit and publishes it. Check its run with `gh run list --workflow release.yml --limit 1`, and
   that `gh release view v<version>` lists `figma-design-relay.zip`. Never tag or release a
   candidate that has not passed the `main` PR gate.

If any gate cannot pass, leave the PR open and report the blocker. Do not replace a missing PR or
review with a local merge, test results, a tag, or permission inferred from the task request.

## 6. Tear down the dev slot

Once the user has merged `dev` → `main`, a task built in a feature worktree ends by removing its
slot — the Dev plugin import in Figma, its MCP entry, then the worktree and branch (`git branch -d`,
never `-D`) — and rebuilding the main checkout so the stable plugin
carries the change. The `start-feature` skill's step 4 has the commands. Ask the user to remove the
Figma import and to confirm before you edit their MCP config.
