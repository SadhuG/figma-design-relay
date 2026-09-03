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

| Where     | Command                                   | Notes                                             |
| --------- | ----------------------------------------- | ------------------------------------------------- |
| root      | `bun install`                             | installs Husky's pre-commit hook                  |
| root      | `bun run format` / `bun run format:check` | Prettier 3.9.6 over everything                    |
| `server/` | `bun run build`                           | `tsc` → `dist/`                                   |
| `plugin/` | `bun run build`                           | two Vite passes: UI, then `main`                  |
| `plugin/` | `bunx tsc --noEmit -p tsconfig.json`      | the plugin has no build-time type-check otherwise |

**Bun everywhere — never `npm` or `yarn`.**

There is **no `test` script in either package yet**. Phase 1, task 1 adds it (`"test": "bun test"`)
plus `exclude: ["src/**/*.test.ts"]` in both tsconfigs. Until that lands, `bun run test` fails with
`Script not found "test"` — that is expected, not a broken checkout.

## Layout

```
server/src/
  index.ts     entry; FIGMA_DESIGN_RELAY_PORT (default 1994)
  node.ts      leader/follower router — every tool call goes through node.sendWithParams()
  leader.ts    HTTP + WebSocket host    follower.ts  proxies to leader over /rpc
  bridge.ts    socket registry keyed by fileKey; 180s per-request timeout
  election.ts  leader election
  schema.ts    Zod input schemas + the RPC validation layer   (1008 lines)
  tools.ts     all 39 MCP tool registrations                  (1159 lines)
plugin/src/
  main/code.ts        request dispatcher, one switch case per tool  (1875 lines)
  main/serializer.ts  scene graph → JSON                             (372 lines)
  html-figma/         vendored html-to-figma importer
  ui/                 React panel
```

### Landmarks worth knowing before editing

- `server/src/schema.ts:593` — `toolInputSchemas`, the advertised MCP input shapes.
- `server/src/schema.ts:910` — `rpcToArgs`, typed `Record<ToolName, …>`. **Adding a key to
  `toolInputSchemas` without adding its mapper here is a compile error.** That is deliberate; do not
  work around it.
- `server/src/schema.ts:989` — `validateRpc`, the follower→leader guard.
- `server/src/tools.ts:92` — `registerTools`; `:662` — `renderResponse`, the shared handler wrapper
  that turns a `BridgeResponse.error` into an MCP error result.
- `plugin/src/main/code.ts:331` — `EDIT_REQUEST_TYPES`; `:359` — `requireEditorMode`. Phase 6
  replaces both with a capability table.
- `plugin/src/main/serializer.ts:349` — `serializeNode`. Phase 2 makes it async.

## The plan set

One spec measures the gap; six plans close it. **Read `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md`
first** — it holds all 55 numbered requirements (R1–R55), and every plan task cites the ones it
satisfies.

| Phase | Plan (`docs/superpowers/plans/…`)                  | Reqs    | Tasks | Needs                  |
| ----- | -------------------------------------------------- | ------- | ----- | ---------------------- |
| 1     | `2026-09-01-run-script-plugin-api-escape-hatch.md` | R1–R10  | 7     | —                      |
| 2     | `2026-09-01-serializer-enrichment.md`              | R11–R19 | 6     | phase 1's test harness |
| 3     | `2026-09-01-design-context-v2.md`                  | R20–R27 | 7     | **phase 2** (R14, R15) |
| 4     | `2026-09-01-code-connect.md`                       | R28–R35 | 8     | **phase 2** (R13)      |
| 5     | `2026-09-01-library-reach.md`                      | R36–R42 | 7     | phase 1's test harness |
| 6     | `2026-09-01-figjam-slides-diagrams.md`             | R43–R50 | 8     | phase 1's test harness |

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
  generalises this to a per-editor capability table.
- **Scripts are not atomic.** The Plugin API has no rollback, so a `run_script` that throws part-way
  leaves its earlier mutations. Say so in docs; do not paper over it.
- The bridge times out a request after **180 seconds**.
- Prettier runs on commit via Husky + lint-staged. Don't fight it — `bun run format` from the root.

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
- After any docs change: `bun run format` then `npx prettier --check "docs/**/*"`.

## Naming

Renamed from "Figma MCP Bridge" in `5ae5a0b`; see
`docs/superpowers/specs/2026-09-02-figma-design-relay-name-change.md` for the canonical table. Do not
reintroduce the old strings.

| Surface        | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Product        | Figma Design Relay                                      |
| npm package    | `@gethopp/figma-design-relay`                           |
| CLI            | `figma-design-relay`                                    |
| Plugin id      | `figma-design-relay`                                    |
| MCP config key | `figma-design-relay`                                    |
| Env vars       | `FIGMA_DESIGN_RELAY_PORT`, `VITE_FIGMA_DESIGN_RELAY_WS` |

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
