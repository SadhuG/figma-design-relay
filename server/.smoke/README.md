# Live smoke-test harness

Drives real tool calls against a real Figma document, exactly the way an MCP client would, without
touching your MCP client config.

## One port: 1994

Everything dials **1994** by default — the relay the MCP client spawns, a default plugin build, and
these probes. `port.mjs` is the single place the harness reads it from. There is nothing else on
this machine that should ever hold 1994, so if `netstat -ano | grep 1994` shows a listener that is
not `server/dist/index.js`, that is the problem, not something to work around.

The plugin bakes its port in at build time. A plain `bun run build` in `plugin/` dials 1994, and the
panel shows which relay it is dialing on its **Relay:** row, so a wrong build is visible in Figma
rather than something you infer from a silent "Disconnected".

## Running it

Two setups, depending on whether an MCP client already has the relay up.

**Join the client's relay** (the usual case — your editor started `figma-design-relay` on 1994 and
the plugin is attached to it):

```bash
cd server && bun run build
node .smoke/probe.mjs 'return figma.currentPage.name;'
node .smoke/call.mjs get_design_context '{"format":"css","assetDir":"tmp-assets"}'
```

Each probe loses the election, becomes a follower, and proxies to the client's leader over HTTP
`/rpc`. The **tool handler runs in the probe's own process**, from the `dist` you just built — but
validation and the plugin bridge run in the leader, from whatever `dist` it was started with.
After changing `schema.ts`, `leader.ts`, `bridge.ts` or `election.ts`, restart the client's server
(or use the isolated setup below) before trusting a probe.

**Hold your own leader** (nothing on 1994, e.g. a plain terminal with no MCP client running):

```bash
cd server && bun run build
node .smoke/hold-leader.mjs          # leave running; the plugin attaches to it
node .smoke/call.mjs get_selection
```

`hold-leader.mjs` exits with a message if something already holds the port, instead of quietly
becoming a second follower and printing "leader".

**Isolated port** (only when you must test a rebuilt leader beside a running client relay):

```bash
cd plugin && VITE_FIGMA_DESIGN_RELAY_WS="ws://localhost:1995/ws" bun run build
cd ../server && bun run build
SMOKE_PORT=1995 node .smoke/hold-leader.mjs
SMOKE_PORT=1995 node .smoke/call.mjs get_selection
```

`plugin/manifest.json` allows 1995 alongside 1994 for this, since Figma blocks any WebSocket to a URL
not on `networkAccess.allowedDomains`. Rebuild the plugin **without** the variable afterwards — a
plugin left dialing 1995 is the classic way to end up "running but not connected".

## Tools that read the workspace

The Code Connect tools read and write files under the **server's working directory**, and the
server `call.mjs` spawns inherits the directory you run it from. Run it from a scratch project to
exercise them without touching this repo:

```bash
mkdir -p "$TEMP/cc-live/src/ui" && cd "$TEMP/cc-live"
echo 'export const Button = () => null;' > src/ui/Button.tsx
node ~/code/figma-design-relay/server/.smoke/call.mjs get_code_connect_suggestions '{"nodeIds":["40:587"]}'
```

`list_files` shows an `unsaved-…` key for this plugin, because Figma only exposes `figma.fileKey`
to private plugins, so `add_code_connect_map` needs `figmaFileKey` — any alphanumeric key will do
for a probe.

## Reading the output

`probe.mjs` drives `run_script`; `call.mjs` drives any tool by name. Both print the port in their
header and `isError:` before the payload, which is what distinguishes a genuine MCP error result
from a success payload that merely describes a failure. `call.mjs` summarises image blocks as
`[image <mime> <bytes>]` — seeing that line at all is the proof that the result carried a real image
block rather than base64 text.

## Relaunch the plugin after every plugin rebuild

Figma desktop hot-reloads a development plugin when its files change — the leader logs a
disconnect/connect pair with a fresh `unsaved-…` key — but a hot-reloaded sandbox cannot fetch
library assets: every `getStyleByIdAsync` / `getVariableByIdAsync` on a library id takes ~11 s and
throws "Unable to establish connection to Figma", so tokens come back as bare ids and a screen takes
minutes. Closing the plugin panel and running it again from the Development menu fixes it
instantly (the same lookup then takes ~300 ms). Do that after any `bun run build` in `plugin/`
before trusting a probe's timing or token names.

The rebuild does not always hot-reload. Twice on 2026-09-27, with the manifest unchanged, it closed
the plugin in every open file instead, and `list_files` stayed empty until each was relaunched.

## Checking the wiring when it will not connect

`netstat -ano | grep 1994` answers most of it. `LISTENING` on `127.0.0.1` means a leader is up (a
listener on `0.0.0.0` or `[::]` is not this project); a matching `ESTABLISHED` pair means the plugin
is attached. `SYN_SENT` means the plugin is retrying against a port with nothing on it. No socket at
all means the plugin is dialing some other port — check its **Relay:** row.

Figma's Development menu lists plugins by name, and every import of a `manifest.json` with this
plugin's name looks the same. Keep exactly one: the one imported from this checkout's
`plugin/manifest.json`. A probe with a bogus `nodeId` tells an old build from a current one — old
builds ignore it and describe the selection instead.

## Scripts

| File                      | Proves                                                       |
| ------------------------- | ------------------------------------------------------------ |
| `r2-figma-in-scope.js`    | R2 — `figma` resolves inside the direct eval; `return` works |
| `r3-write-returns-ids.js` | R3 — a write lands and its node id comes back                |
| `r6-error-path.js`        | R6 — a throwing script surfaces as an MCP error result       |

R7's Dev Mode gate is **not** here: Dev Mode needs a paid Figma seat. It is covered by
`plugin/src/main/capabilities.test.ts` instead. Annotations are different: a person can only type
one in Dev Mode, but a `run_script` can write one from the design editor with
`node.annotations = [{ label: "…" }]`, so the serializer's annotation field can be checked live
without the seat.
