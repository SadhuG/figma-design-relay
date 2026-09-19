# Figma Design Relay — working notes

A Figma **plugin** + **MCP server** that streams live Figma document data to AI tools over a local
WebSocket, with no Figma REST API and therefore no rate limits. The plugin runs inside Figma and owns
the document; the server speaks MCP to the agent and forwards every call over the socket. One server
instance is the leader (holds the WebSocket, port 1994); others become followers and proxy over HTTP
`/rpc`.

```
Figma plugin ──ws://localhost:1994/ws──> leader server ──stdio──> agent
                                            ▲ HTTP /rpc
                                         followers
```

## Commands

| Where     | Command                                   | Notes                                          |
| --------- | ----------------------------------------- | ---------------------------------------------- |
| root      | `bun install`                             | installs Husky's pre-commit hook               |
| root      | `bun run format` / `bun run format:check` | Prettier 3.9.6 over everything                 |
| `server/` | `bun run build`                           | `tsc` → `dist/`                                |
| `plugin/` | `bun run build`                           | two Vite passes: UI, then `main`               |
| `plugin/` | `bun run typecheck`                       | `tsc --noEmit`; `bun run build` runs it first  |
| `server/` | `bun test`                                | 64 tests: schemas, rpc guards, codegen, assets |
| `plugin/` | `bun test`                                | 73 tests: scripts, serializer, editor gate     |

**Bun everywhere — never `npm` or `yarn`.**

Both packages run tests with `bun test` (phase 1, task 1 added the script and the
`exclude: ["src/**/*.test.ts"]` entry in both tsconfigs). Tests live beside the code they cover as
`*.test.ts`.

### Type-checking

`vite build` compiles with esbuild, which strips types without checking them, so building the plugin
proves nothing about its types on its own. `plugin/`'s `build` therefore runs `typecheck` first and
aborts before Vite if it fails. The server needs no equivalent because its build command _is_ `tsc`.

`.github/workflows/ci.yml` runs the plugin type-check, both test suites, and both builds on every
push to any branch and on every pull request. Every branch, not just `main` and `dev`, because
upstream merges get resolved on a feature branch and fast-forwarded onto `dev` without a PR — a
gate that only watched PRs would never see them. `release.yml` is separate and still manual.

**The plugin type-check passes with zero errors; keep it that way.** It sat at seven for a long
while precisely because nothing enforced it. If a change makes `tsc` unhappy, the fix is the code,
not the tsconfig.

### Verifying against a real Figma document

`server/.smoke/` drives real tool calls against a live file exactly the way an MCP client would.
`probe.mjs` drives `run_script`; `call.mjs` drives any tool by name. See `server/.smoke/README.md`.

**One port, 1994, everywhere.** The MCP client's relay, a default plugin build and the smoke probes
all use it; `server/.smoke/port.mjs` is the harness's single source and `SMOKE_PORT` the only
override. The probes join whatever leader holds 1994 as followers — normally the client's own
relay, so no extra process is needed. `hold-leader.mjs` is for when nothing is listening, and it
exits with a message rather than silently becoming a second follower. The isolated 1995 setup
(plugin rebuilt with `VITE_FIGMA_DESIGN_RELAY_WS`) exists only for testing a rebuilt leader
beside a running client relay; rebuild the plugin without the variable afterwards.

The MCP entry lives in `~/.claude.json` under `mcpServers.figma-design-relay` and must point at
**this checkout's** `server/dist/index.js`. It once pointed at a worktree under the repo's old name,
which is what "Connection closed" at session start looks like. There is exactly one relay on this
machine now — the upstream `@gethopp/figma-mcp-bridge` entry that used to hold 1994 (bound to
`[::]`, so it accepted the plugin and swallowed every probe) is gone, and so is the stale
`feat-run-script` worktree. Do not bring either back.

Things that cost real time before they were understood:

- **The plugin panel says which relay it dials** on its `Relay:` row. A plugin that is "running but
  not connected" with no socket in `netstat` is dialing a different port — almost always a build
  left over from the isolated setup, or a second Development-menu import of a same-named manifest
  from another directory. Keep exactly one import, from this checkout's `plugin/manifest.json`.
- **Relaunch the plugin after every plugin rebuild.** Figma desktop hot-reloads a dev plugin when
  its files change, but a hot-reloaded sandbox cannot fetch library assets — every library style or
  variable lookup takes ~11 s and throws, so tokens come back as bare ids. Close the panel and run
  the plugin again from the Development menu; the same lookup then takes ~300 ms.
- **The leader is stale after a server rebuild.** A probe's tool handler runs in the probe's own
  fresh process, but validation and the bridge run in the leader from whatever `dist` started it.
  After touching `schema.ts`, `leader.ts`, `bridge.ts` or `election.ts`, restart the client's
  server (or use the isolated port) before trusting a probe.
- **The follower → leader hop validates and strips.** `validateRpc` drops `nodeId` from params for
  every tool, because for all the older tools it is a fold of `nodeIds`. A tool that wants a real
  node id must send it on `nodeIds` and read `request.nodeIds[0]` in the plugin. Unit tests never
  see this — only the direct leader path is exercised — so a new node-addressed tool needs one
  live probe through a follower.

## Layout

```
server/src/
  index.ts     entry; FIGMA_DESIGN_RELAY_PORT (default 1994)
  node.ts      leader/follower router — every tool call goes through node.sendWithParams()
  leader.ts    HTTP + WebSocket host    follower.ts  proxies to leader over /rpc
  bridge.ts    socket registry keyed by fileKey; 180s per-request timeout
  election.ts  leader election
  schema.ts    Zod input schemas + the RPC validation layer   (1023 lines)
  tools.ts     all 40 MCP tool registrations                  (1189 lines)
plugin/src/
  main/code.ts        request dispatcher, one switch case per tool  (1912 lines)
  main/serializer.ts  scene graph → JSON; async since phase 2        (492 lines)
  main/references.ts        variable + style ids → resolved names
  main/component-identity.ts component and instance identity
  main/intent.ts            layout intent, reactions, annotations, exports
  html-figma/         vendored html-to-figma importer
  ui/                 React panel
```

### Landmarks worth knowing before editing

- `server/src/schema.ts:593` — `toolInputSchemas`, the advertised MCP input shapes.
- `server/src/schema.ts:924` — `rpcToArgs`, typed `Record<ToolName, …>`. **Adding a key to
  `toolInputSchemas` without adding its mapper here is a compile error.** That is deliberate; do not
  work around it.
- `server/src/schema.ts:1004` — `validateRpc`, the follower→leader guard.
- `server/src/tools.ts:113` — `registerTools`; `:692` — `renderResponse`, the shared handler wrapper
  that turns a `BridgeResponse.error` into an MCP error result.
- `plugin/src/main/editor-gate.ts:7` — `EDIT_REQUEST_TYPES`; `:43` — `requireEditorMode`, which
  takes `editorType` as a parameter rather than reading `figma.editorType`, so the Dev Mode gate is
  unit-testable. Dispatch calls both at `plugin/src/main/code.ts:337`. Phase 6 replaces the pair with
  a capability table.
- `plugin/src/main/serializer.ts:451` — `serializeNode`, `async` since phase 2 and awaited at four
  call sites in `code.ts`. Only `get_design_context` type-errors if you forget an `await` — the other
  three sites type `data` as `unknown` and will happily ship an unresolved promise. The `figma`
  lookups it feeds to `references.ts` live at `:396`; the three helper modules never name the global.
  `docs/serialized-nodes.md` documents the emitted shape and, for every field, when it is omitted.
- `plugin/src/main/code.ts:1834` — the UI-collapse block that closes the file: window sizing,
  the `ui-collapsed` `figma.clientStorage` key, and the `request-ui-state` / `set-ui-collapsed`
  messages the React panel exchanges with the main thread. Note `figma.showUI` runs with
  `visible: false` and the panel is only shown once the stored state resolves — anything that
  returns early before `figma.ui.show()` leaves the plugin window invisible. Came from upstream
  `ef0cf04`; phase 6 edits this file heavily and should leave the tail alone.

## The plan set

One spec measures the gap; six plans close it. **Read `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md`
first** — it holds all 55 numbered requirements (R1–R55), and every plan task cites the ones it
satisfies.

| Phase | Plan (`docs/superpowers/plans/…`)                  | Reqs    | Tasks | Needs                  | Status      |
| ----- | -------------------------------------------------- | ------- | ----- | ---------------------- | ----------- |
| 1     | `2026-09-01-run-script-plugin-api-escape-hatch.md` | R1–R10  | 7     | —                      | **done**    |
| 2     | `2026-09-01-serializer-enrichment.md`              | R11–R19 | 6     | phase 1's test harness | in progress |
| 3     | `2026-09-01-design-context-v2.md`                  | R20–R27 | 7     | **phase 2** (R14, R15) | **done**    |
| 4     | `2026-09-01-code-connect.md`                       | R28–R35 | 8     | **phase 2** (R13)      | not started |
| 5     | `2026-09-01-library-reach.md`                      | R36–R42 | 7     | phase 1's test harness | not started |
| 6     | `2026-09-01-figjam-slides-diagrams.md`             | R43–R50 | 8     | phase 1's test harness | not started |

R51–R55 are cross-cutting and apply to every tool any phase adds.

Phases 3 and 4 have **real** dependencies on phase 2, not preference ones: without resolved token and
style names, phase 3 cannot emit `var(--token)`; without component property definitions, phase 4
cannot author accurate mappings. Phases 5 and 6 are independent of 2–4 and can be done in any order
after phase 1.

### Executing a plan

1. Read the phase's requirement block in the spec, then the plan's **markdown** — not the HTML.
2. Work tasks in order. Each is a full TDD cycle: failing test → run it and see it fail → minimal
   implementation → run it and see it pass → commit.
3. **Run the failing-test step and actually look at the failure.** A test that passes before the
   implementation exists is testing nothing.
4. One commit per task, using the message the plan gives.
5. A task's "Interfaces / Produces" block is the contract later tasks were written against. If you
   change a name there, grep for it in the later tasks of the same plan.

Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to drive it.

## Constraints that actually bite

- **Server imports need the `.js` extension.** `server/` is ESM with `"module": "Node16"`, so it is
  `./schema.js` even though the file is `schema.ts`. Plugin sources are the opposite — extensionless
  (`./serializer`), because Vite resolves them.
- **`documentAccess: "dynamic-page"`** is set in `plugin/manifest.json`. The synchronous accessors do
  not work: use `figma.getNodeByIdAsync`, `instance.getMainComponentAsync()`,
  `figma.getStyleByIdAsync`, `figma.variables.getVariableByIdAsync`.
- **New plugin modules must not reference the `figma` global.** Take lookups as parameters instead.
  That is the only reason those modules can be unit-tested under Bun, and every phase-2/5/6 plan
  depends on it.
- **Direct `eval`, never `(0, eval)`.** Figma's sandbox wraps plugin code in `with (scopeProxy) { … }`;
  a direct eval inherits that scope chain and resolves `figma`, an indirect one does not. Isolated in
  `plugin/src/main/eval-direct.ts` once phase 1 lands.
- **Filesystem paths must resolve inside the MCP server's working directory**, checked with
  `realpath`. `import_html_layers` and `save_screenshots` already do this; every new file-touching
  tool must too.
- **Dev Mode is read-only.** Write tools are rejected up front rather than failing at runtime. Phase 6
  generalises this to a per-editor capability table. **Dev Mode needs a paid Figma seat, which this
  project does not have**, so the gate cannot be exercised by hand — verify it with
  `plugin/src/main/editor-gate.test.ts` instead, and do not budget a manual Dev Mode step in a plan.
- **Scripts are not atomic.** The Plugin API has no rollback, so a `run_script` that throws part-way
  leaves its earlier mutations. Say so in docs; do not paper over it.
- **The leader binds `127.0.0.1`, never `0.0.0.0`.** `/rpc` runs every tool — `run_script`
  included — with no authentication, so it must not be reachable off this machine. It also rejects
  any request carrying an `Origin` header or a non-JSON content type, which is what stops a web
  page the user happens to visit from driving the relay through the browser. `LOOPBACK_HOST` in
  `server/src/types.ts` is the single source for the address; followers and the election dial the
  same literal rather than `localhost`, because that name can resolve to `::1` first.
- The bridge times out a request after **180 seconds**.
- Prettier runs on commit via Husky + lint-staged. Don't fight it — `bun run format` from the root.
- **Everything is LF, enforced by `.gitattributes` (`* text=auto eol=lf`).** Do not remove it and do
  not commit CRLF. Windows clones default to `core.autocrlf=true`, which used to hand out CRLF
  working copies: `format:check` then failed locally while passing in CI, `git status` showed dozens
  of files as modified with empty content diffs, and `.husky/pre-commit` picked up a CR — harmless
  only because it is one line with no shebang, since either would break it with
  `bad interpreter: /bin/sh^M`. If a checkout ever comes back with CRLF, the attributes file is the
  thing to check first.

## The docs site

`docs/superpowers/` holds the spec and plans as markdown plus a rendered HTML page for each, sharing
`assets/doc.css` and `assets/doc.js`.

- **The markdown is the source of truth.** It is what executor agents read.
- Pages for **phases 2–6 are generated**: `node docs/superpowers/_src/build-plans.mjs`. Never hand-edit
  those HTML files — edit the markdown and rebuild.
- The **phase 1 page and the spec page are hand-authored** and not in the generator's list. Edit them
  directly.
- The generator expects a strict markdown shape (`### Task N: Name [R1, R2]`, `**Files:**`,
  `**Interfaces:**`, `- [ ] **Step N: …**`, `Run:` / `Expected:` lines). Run Prettier on the markdown
  **before** regenerating, then format the HTML — Prettier reflows markdown lists and the parser
  reads the reflowed shape.
- **Checkbox state carries through.** A step written `- [x]` renders pre-checked and `is-done`; the
  rail's per-task progress is then derived by `doc.js`. Mark a phase's progress in the markdown and
  rebuild — never by hand-editing the HTML. Always confirm the reported step count matches the
  markdown: the generator used to match only `- [ ]`, so checking a box silently dropped the step
  from the page, and a suspiciously low count is the symptom.
- After any docs change: `bun run format` then `npx prettier --check "docs/**/*"`.

## Naming

Renamed from "Figma MCP Bridge" in `5ae5a0b`; see
`docs/superpowers/specs/2026-09-02-figma-design-relay-name-change.md` for the canonical table. Do not
reintroduce the old strings.

| Surface        | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Product        | Figma Design Relay                                      |
| npm package    | _none_ — see "Releases" below                           |
| CLI            | `figma-design-relay`                                    |
| Plugin id      | `figma-design-relay`                                    |
| MCP config key | `figma-design-relay`                                    |
| Env vars       | `FIGMA_DESIGN_RELAY_PORT`, `VITE_FIGMA_DESIGN_RELAY_WS` |

## Releases

**Nothing is published to npm, and nothing should be.** The `@gethopp` scope belongs to the upstream
maintainer, so `server/package.json` is named `figma-design-relay-server` and marked
`"private": true` — `npm publish` refuses it. Do not "fix" that by renaming it back.

`.github/workflows/release.yml` is `workflow_dispatch` with two inputs: a semantic `version` and
`dry_run`, which **defaults to true**. A dry run builds, packages, and uploads the archive as a build
artifact, but creates no tag and no release; a real release is an explicit opt-out. Use a dry run
whenever the workflow itself changes, since it is otherwise never exercised.

The archive carries both halves — `plugin/` (self-contained) and `server/` (`dist` plus
`package.json` and `bun.lock`, because dependencies are not bundled and the user runs
`bun install --production`). README's Quick Start documents that flow; keep the two in step.

Every action in both workflows runs on **node24**. GitHub is force-running node20 actions on node24
and will eventually stop, so when adding an action, check its `action.yml` `runs.using` at the exact
ref you pin rather than assuming a high version number means a current runtime — `softprops/action-gh-release@v2`
was still node20 well after v3 shipped.

## Syncing with upstream

This repo is a fork of `gethopp/figma-mcp-bridge`, wired up as the `upstream` remote (its push URL is
set to `DISABLED` so nothing can be pushed there by accident). Sync with `git fetch upstream` then
`git merge upstream/main` — a merge, never a cherry-pick or squash, so the next sync's merge base
stays correct and the same commit never conflicts twice.

Expect conflicts wherever the rename touched a file upstream also edits. They are almost always
re-indentation colliding with a renamed string rather than a real disagreement: take upstream's
structure and keep this fork's names. Afterwards run
`git grep -n "figma-mcp-bridge\|FIGMA_BRIDGE\|Figma MCP Bridge" -- plugin server` — auto-merged hunks
are the easy way for old strings to slip back in, and the naming table above is not negotiable.

Upstream does not run our Prettier config, so its files usually arrive unformatted; the Husky hook
normalizes whatever you stage. CI verifies a sync for you on push, but the same checks run locally:
`bun run typecheck` and `bun test` in `plugin/`, `bun test` in `server/`, and a build of each. The
plugin type-check is clean and expected to stay that way — **a non-zero count means the merge broke
something**, so do not wave it through.

## Conventions

- Every new MCP tool needs: a `toolInputSchemas` entry, an `rpcToArgs` mapper, an optional `fileKey`
  parameter routed through `node.sendWithParams`, a README table row, and unit tests.
- Tool descriptions carry the rules an agent needs, because this server ships no skills. Where the
  bridge is narrower than Figma's own server, **say so in the description's first sentence** — an
  overstated description is a defect.
- Errors say what to do next, not just what went wrong. "Open the plugin in the target file and
  retry" beats "Plugin not connected".
- Commit messages: `feat(scope): …`, `fix(scope): …`, `docs: …`, `test: …`, `chore: …`.
- **Keep the docs current as you work.** When you discover a durable fact, settle a convention, add a
  command, or change a workflow, write it into the right place — this file, the `.claude/` config, the
  README, or the `docs/superpowers/` spec and plans — as part of finishing the work, not afterwards.
  These docs are the source of truth that future sessions and executor agents rely on; anything left
  only in a conversation is lost.
