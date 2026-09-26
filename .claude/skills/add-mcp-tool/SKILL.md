---
name: add-mcp-tool
description: Use when adding, renaming or removing an MCP tool in figma-design-relay — the checklist of every place across server and plugin a tool must be wired, tested and documented.
---

# Adding an MCP tool

Work it test-first (`superpowers:test-driven-development`). A tool is done when every box holds.

## Server

- [ ] `toolInputSchemas` entry in `server/src/schema.ts` — Zod shape, with an optional `fileKey`.
- [ ] `rpcToArgs` mapper in the same file. Forgetting it is a compile error by design.
- [ ] Registration in `server/src/tools.ts` (`registerTools`), routed through
      `node.send` / `node.sendWithParams` with the caller's `fileKey`, and wrapped in `renderResponse`.
- [ ] Description: rules an agent needs, and — where the relay is narrower than Figma's own server —
      that limitation **in the first sentence**. Error messages say what to do next.
- [ ] Node-addressed? Send the id on `nodeIds`; `validateRpc` strips `nodeId` on the follower hop.
- [ ] Touches the filesystem? Resolve inside the working directory with `realpath`; walk it only
      through `walkWorkspace`.
- [ ] Unit tests beside the code (`*.test.ts`): schema, `rpcToArgs`, and the handler's logic.

## Plugin

- [ ] A `case` in `plugin/src/main/code.ts`'s dispatcher, keyed by the **request type** it receives.
- [ ] Logic in a module that takes Figma lookups as parameters rather than naming the `figma`
      global, so Bun can test it.
- [ ] Editor-specific or a write? A `CAPABILITIES` entry in `plugin/src/main/capabilities.ts` in the
      same commit — keyed by request type, with `tool` set if the MCP name differs.
- [ ] Needs a manifest permission? Read the gated global through a getter inside
      `withPermissionContext` so the refusal is actionable.
- [ ] Type-check at zero errors.

## Docs and proof

- [ ] README Available Tools row; a guide under `docs/guides/` if the tool has a contract worth
      explaining.
- [ ] Bump "N MCP tool registrations" in CLAUDE.md's Layout.
- [ ] One live call through a follower (`live-figma-check` skill) — unit tests only see the direct
      leader path.
- [ ] Then the `finish-task` skill.
