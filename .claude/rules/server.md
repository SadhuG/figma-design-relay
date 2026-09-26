---
paths:
  - "server/**"
---

# Server rules

## Landmarks

- `server/src/schema.ts:676` — `toolInputSchemas`, the advertised MCP input shapes.
- `server/src/schema.ts:1141` — `rpcToArgs`, typed `Record<ToolName, …>`. **Adding a key to
  `toolInputSchemas` without its mapper here is a compile error.** That is deliberate; do not work
  around it.
- `server/src/schema.ts:1234` — `validateRpc`, the follower → leader guard.
- `server/src/tools.ts:279` — `registerTools`; `:1245` — `renderResponse`, the shared handler
  wrapper that turns a `BridgeResponse.error` into an MCP error result.

Adding a tool? Use the `add-mcp-tool` skill — it is a checklist across both packages.

## Constraints

- **Imports need the `.js` extension.** `server/` is ESM with `"module": "Node16"`, so it is
  `./schema.js` even though the file is `schema.ts`. (Plugin imports are the opposite.)
- **The build is `tsc`,** so building the server type-checks it; there is no separate step.
- **The leader binds `127.0.0.1`, never `0.0.0.0`.** `/rpc` runs every tool — `run_script`
  included — with no authentication, so it must not be reachable off this machine. It also rejects
  any request carrying an `Origin` header or a non-JSON content type, which stops a web page the
  user visits from driving the relay through the browser. `LOOPBACK_HOST` in `src/types.ts` is the
  single source; followers and the election dial the same literal, not `localhost`, which can
  resolve to `::1` first.
- **Filesystem paths must resolve inside the server's working directory,** checked with `realpath`.
  `import_html_layers`, `save_screenshots` and `get_design_context`'s `assetDir` do; every new
  file-touching tool must too. Anything that walks the working directory goes through
  `walkWorkspace` in `src/code-connect/discover.ts`, which skips `node_modules` and friends, drops
  links that resolve outside, and stops after 10,000 directories — some MCP clients start servers in
  `/`, and `get_design_context` walks on every call.
- **The follower → leader hop validates and strips.** `validateRpc` drops `nodeId` from params for
  every tool, because for the older tools it is a fold of `nodeIds`. A tool that needs a real node
  id sends it on `nodeIds` and the plugin reads `request.nodeIds[0]`. Unit tests only exercise the
  direct leader path, so a new node-addressed tool needs one live probe through a follower.
- **The relay's `fileKey` is usually not a Figma file key.** `figma.fileKey` is exposed only to
  private plugins, so this plugin connects under a session key starting `unsaved-`. Anything needing
  the real key (a Code Connect URL, matching a mapping) treats `unsaved-…` as unknown
  (`pickFigmaFileKey`) and lets the caller pass the key from the file's URL, as
  `add_code_connect_map`'s `figmaFileKey` does.
- The bridge times out a request after **180 seconds** (`src/bridge.ts`).
- **A leader keeps running the `dist` it started from.** After touching `schema.ts`, `leader.ts`,
  `bridge.ts` or `election.ts`, restart the client's relay before trusting a live probe.

## Tool descriptions

This server ships no skills, so a tool's description is where an agent learns its rules. Where the
relay is narrower than Figma's own server, **say so in the first sentence** — an overstated
description is a defect. Errors say what to do next ("Open the plugin in the target file and
retry"), not just what went wrong.
