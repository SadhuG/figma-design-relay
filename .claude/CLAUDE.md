# Figma Design Relay

A Figma **plugin** + **MCP server** that streams live Figma document data to AI tools over a local
WebSocket — no Figma REST API, so no rate limits. The plugin runs inside Figma and owns the
document; the server speaks MCP to the agent and forwards every call over the socket. One server
instance is the leader (holds the WebSocket on port 1994); the rest become followers and proxy over
HTTP `/rpc`.

```
Figma plugin ──ws://localhost:1994/ws──> leader server ──stdio──> agent
                                            ▲ HTTP /rpc
                                         followers
```

## Where the rest lives

This file holds only what applies to every task. The rest loads when it is relevant:

| Path                              | Loads                                                         | Holds                                                               |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `.claude/rules/server.md`         | automatically, on `server/**`                                 | landmarks, ESM imports, loopback, filesystem and follower-hop rules |
| `.claude/rules/plugin.md`         | automatically, on `plugin/**`                                 | landmarks, `figma` global, async access, capability table, manifest |
| `.claude/rules/docs.md`           | automatically, on `docs/**`                                   | the HTML generator, checkbox state, moving docs                     |
| `.claude/rules/release.md`        | on `CHANGELOG.md`, `package.json`, `.github/**`, `scripts/**` | versions, tags, release workflow, CI                                |
| `.claude/skills/finish-task`      | **before every task's last commit**                           | verify, refresh facts, bump, agent review, merge `dev` then `main`  |
| `.claude/skills/add-mcp-tool`     | when adding or removing a tool                                | every place a tool must be wired, tested and documented             |
| `.claude/skills/live-figma-check` | when testing against real Figma                               | smoke harness, the machine's relay setup, symptoms that cost time   |
| `.claude/skills/sync-upstream`    | when merging `upstream/main`                                  | merge procedure, rename conflicts, old-name hunt                    |
| `docs/README.md`                  | —                                                             | user guides, reference, and the specs/plans design history          |

## Commands

**Bun everywhere — never `npm` or `yarn`.**

| Where     | Command                                   | Notes                                                                     |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| root      | `bun install`                             | installs Husky's pre-commit hook (Prettier via lint-staged)               |
| root      | `bun run format` / `bun run format:check` | Prettier 3.9.6 over everything                                            |
| root      | `bun scripts/check-version.mjs`           | server + plugin versions agree and have a changelog entry                 |
| `server/` | `bun run build`                           | `tsc` → `dist/`; this is the server's type-check                          |
| `server/` | `bun test`                                | 251 tests: schemas, rpc guards, codegen, assets, Code Connect, Mermaid    |
| `plugin/` | `bun run typecheck`                       | `tsc --noEmit`; must stay at zero errors                                  |
| `plugin/` | `bun run build`                           | typecheck, then two Vite passes: UI, then `main`                          |
| `plugin/` | `bun test`                                | 196 tests: scripts, serializer, capability table, library tools, diagrams |

Tests live beside the code as `*.test.ts` (excluded from both tsconfigs). CI (`.github/workflows/ci.yml`)
runs all of the above on every push to every branch.

## Layout

```
server/src/
  index.ts      entry; FIGMA_DESIGN_RELAY_PORT (default 1994)
  node.ts       leader/follower router — every tool call goes through node.send / sendWithParams
  leader.ts     HTTP + WebSocket host     follower.ts  proxies to leader over /rpc
  bridge.ts     socket registry keyed by fileKey; 180 s per-request timeout
  election.ts   leader election
  schema.ts     Zod input schemas + the RPC validation layer
  tools.ts      all 53 MCP tool registrations
  content.ts    typed MCP content blocks (text + image) for tool results
  assets.ts     writes exported design assets inside the working directory
  codegen/      tokens, then React / HTML / CSS reference code behind index.ts's dispatcher
  code-connect/ discovers, parses, indexes, suggests and writes local *.figma.tsx mappings
  mermaid/      parse.ts (the strict Mermaid subset) + layout.ts (positions) for generate_diagram
  types.ts      shared types; LOOPBACK_HOST lives here
server/.smoke/  live harness: probe.mjs (run_script), call.mjs (any tool) — see its README
plugin/src/
  main/code.ts              request dispatcher, one switch case per tool
  main/serializer.ts        scene graph → JSON (async)
  main/references.ts        variable + style ids → resolved names
  main/component-identity.ts component and instance identity
  main/intent.ts            layout intent, reactions, annotations, exports
  main/capabilities.ts      which tool runs in which editor; the dispatcher's up-front gate
  main/figjam-serializer.ts stickies, connectors (with endpoints), shapes, code blocks, tables
  main/diagram.ts           render_diagram's payload check, shape/cap mapping, placement,
                            connector attaching and label fonts
  main/script-runner.ts     run_script; eval-direct.ts + script-result.ts beside it
  main/library.ts           whoami, get_libraries, import_library_asset, search_design_system
  main/permissions.ts       permission and plan refusals → actionable errors
  main/search.ts            search_design_system's matcher and ranker
  html-figma/               vendored html-to-figma importer
  ui/                       React panel
docs/           guides/ and reference/ for users; superpowers/ for specs and plans
.claude/        this file, rules/ (path-scoped) and skills/ — the table above
```

## Rules that apply everywhere

- **Everything is LF** (`.gitattributes`: `* text=auto eol=lf`). Never commit CRLF. If a Windows
  checkout shows dozens of files modified with empty diffs, or `format:check` fails locally but
  passes in CI, check the attributes file first.
- **The leader binds `127.0.0.1`, never `0.0.0.0`** — `/rpc` runs every tool, `run_script` included,
  unauthenticated.
- **Write regex- or backslash-bearing source with the Edit/Write tools**, never a shell heredoc or
  `bun -e` string: those collapse `\\` to `\`, and once shipped a matcher that never matched. Use
  `String.raw` for `new RegExp` templates and check the compiled string, not the source.
- **Nothing is published to npm.** `server/package.json` is private; do not rename it back to
  upstream's `@gethopp` scope.
- Tool descriptions state where the relay is narrower than Figma's own server in their **first
  sentence**; errors say what to do next.
- Don't fight Prettier — `bun run format` from the root.

## Naming

Renamed from "Figma MCP Bridge" in `5ae5a0b`
(`docs/superpowers/specs/2026-09-02-figma-design-relay-name-change.md`). Never reintroduce the old
strings.

| Surface                   | Value                                                   |
| ------------------------- | ------------------------------------------------------- |
| Product                   | Figma Design Relay                                      |
| CLI / plugin id / MCP key | `figma-design-relay`                                    |
| Env vars                  | `FIGMA_DESIGN_RELAY_PORT`, `VITE_FIGMA_DESIGN_RELAY_WS` |
| npm package               | none — `figma-design-relay-server`, `"private": true`   |

## Workflow

- Work on a feature branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
- Commit messages: `feat(scope): …`, `fix(scope): …`, `docs: …`, `test: …`, `chore: …`.
- New behaviour is test-first: failing test, see it fail, implement, see it pass, commit.
- **Before the last commit of any task, run the `finish-task` skill** — unasked. It refreshes the
  facts in this file that drift with the code (test counts, landmarks, layout, tool count), bumps
  the version (minor per finished phase, patch per fix or tooling change, none for docs-only), and
  merges the branch into `dev`, then `dev` into `main`, with real merges.
- **Nothing is pulled or merged until a separate agent has reviewed it.** Before any merge into
  `dev` or `main` — a feature branch, an upstream sync, anything — spawn a fresh agent to do a full
  code review of the whole diff against the target branch. The agent that wrote the code reviewing
  it does not count. Fix or answer every finding, re-verify, and tell the user what the review found
  and what was done; only then merge. `finish-task` step 4 holds the procedure.
- **Keep the docs current as you work.** A durable fact, settled convention, new command or changed
  workflow goes into the right file — this one, a `.claude/` rule or skill, the README, or `docs/` —
  as part of the work. Anything left only in a conversation is lost. Keep volatile numbers to the
  ones a reader would act on.
- The design history — the official-MCP parity spec (R1–R55) and its six delivered phase plans —
  is indexed in `docs/superpowers/README.md`, including what is not implemented yet and why.
