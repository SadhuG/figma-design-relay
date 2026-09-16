# Live smoke-test harness

Drives a real `run_script` call against a real Figma document, without touching your MCP client
config and without disturbing a stock relay already running on 1994.

Everything here runs on **port 1995**, which `plugin/manifest.json` lists in
`networkAccess.allowedDomains` alongside 1994 for exactly this reason. Figma blocks any WebSocket to
a URL not on that list, so the extra entry is what makes an isolated test instance possible at all.

## Why two processes

`probe.mjs` spawns its own server and exits when the call returns, so on its own nothing is listening
between probes and the plugin's socket has nothing to hold. `hold-leader.mjs` keeps a long-lived
leader on 1995; each probe then loses the election, becomes a follower, and proxies to it over HTTP
`/rpc`.

## Running it

```bash
cd plugin
VITE_FIGMA_DESIGN_RELAY_WS="ws://localhost:1995/ws" bun run build

cd ../server
bun run build
node .smoke/hold-leader.mjs          # leave running

# in Figma: Plugins > Development > Import plugin from manifest > plugin/manifest.json,
# open a design file, run the plugin

node .smoke/probe.mjs .smoke/r2-figma-in-scope.js
node .smoke/probe.mjs 'return figma.currentPage.name;'      # or an inline script

node .smoke/call.mjs get_design_context                      # any tool, JSON args optional
node .smoke/call.mjs get_design_context '{"format":"css","assetDir":"tmp-assets"}'
```

`probe.mjs` drives `run_script`; `call.mjs` drives any tool by name. Both print `isError:` before
the payload, which is what distinguishes a genuine MCP error result from a success payload that
merely describes a failure. `call.mjs` summarises image blocks as `[image <mime> <bytes>]` — seeing
that line at all is the proof that the result carried a real image block rather than base64 text.

## Relaunch the plugin after every plugin rebuild

Figma desktop hot-reloads a development plugin when its files change — the leader logs a
disconnect/connect pair with a fresh `unsaved-…` key — but a hot-reloaded sandbox cannot fetch
library assets: every `getStyleByIdAsync` / `getVariableByIdAsync` on a library id takes ~11 s and
throws "Unable to establish connection to Figma", so tokens come back as bare ids and a screen takes
minutes. Closing the plugin panel and running it again from the Development menu fixes it
instantly (the same lookup then takes ~300 ms). Do that after any `bun run build` in `plugin/`
before trusting a probe's timing or token names.

## Checking the wiring when it will not connect

`netstat -ano | grep 1995` answers most of it. `LISTENING` means the leader is up; a matching
`ESTABLISHED` pair means the plugin is attached. `SYN_SENT` means the plugin is retrying against a
port with nothing on it — start `hold-leader.mjs`. The plugin's local port changes on every relaunch,
which is a reliable way to tell a fresh plugin instance from a stale one still holding the old
socket.

## Scripts

| File                      | Proves                                                       |
| ------------------------- | ------------------------------------------------------------ |
| `r2-figma-in-scope.js`    | R2 — `figma` resolves inside the direct eval; `return` works |
| `r3-write-returns-ids.js` | R3 — a write lands and its node id comes back                |
| `r6-error-path.js`        | R6 — a throwing script surfaces as an MCP error result       |

R7's Dev Mode gate is **not** here: Dev Mode needs a paid Figma seat. It is covered by
`plugin/src/main/editor-gate.test.ts` instead.
