# Live smoke-test harness

Drives real tool calls against a real Figma document, exactly the way an MCP client would, without
touching your MCP client config.

## Ports: 1994 stable, one per feature worktree

The main checkout is the stable relay: its MCP server, its plugin build and these probes all use
**1994**, and nothing else on this machine should ever hold 1994. A feature worktree holds a **dev
slot** (`.dev-slot.json`, see the `start-feature` skill) with its own port from 1995–2019; its
server, its plugin build and these probes all read that port from the slot instead. `port.mjs` is
the single place the harness reads its port from: `SMOKE_PORT`, else the slot, else 1994.

So a probe run inside a worktree drives that worktree's Dev plugin, and a probe run in the main
checkout drives the stable one. The plugin panel's **Relay:** row shows the address a running plugin
dials, and Figma's window title shows which plugin it is.

## Running it

Two setups, depending on whether an MCP client already has the relay up.

**Join the client's relay** (the usual case — your editor started the relay, `figma-design-relay`
on 1994 or a worktree's `figma-design-relay-dev-<name>` on its slot port, and the plugin is attached
to it):

```bash
cd server && bun run build
node .smoke/probe.mjs 'return figma.currentPage.name;'
node .smoke/call.mjs get_design_context '{"format":"css","assetDir":"tmp-assets"}'
```

Each probe loses the election, becomes a follower, and proxies to the client's leader over HTTP
`/rpc`. The **tool handler runs in the probe's own process**, from the `dist` you just built — but
validation and the plugin bridge run in the leader, from whatever `dist` it was started with.
After changing `schema.ts`, `leader.ts`, `bridge.ts` or `election.ts`, restart the client's server
(or work in a feature worktree, whose relay is its own — see below) before trusting a probe.

**Hold your own leader** (nothing on the port, e.g. a plain terminal with no MCP client running):

```bash
cd server && bun run build
node .smoke/hold-leader.mjs          # leave running; the plugin attaches to it
node .smoke/call.mjs get_selection
```

`hold-leader.mjs` exits with a message if something already holds the port, instead of quietly
becoming a second follower and printing "leader".

**A rebuilt leader beside a running client relay** is what a feature worktree's slot is for: the
worktree's server leads on the slot's port, so restarting it after a change to `schema.ts`,
`leader.ts`, `bridge.ts` or `election.ts` never touches the stable relay. With no MCP entry for the
slot yet, `node .smoke/hold-leader.mjs` in the worktree holds the slot's port instead. The old
recipe of building the stable plugin with `VITE_FIGMA_DESIGN_RELAY_WS` pointing at 1995 is gone:
the stable manifest allows only 1994, and in a worktree the build refuses a URL that contradicts
the slot.

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

`netstat -ano | grep 1994` (or the slot's port) answers most of it. `LISTENING` on `127.0.0.1` means
a leader is up (a listener on `0.0.0.0` or `[::]` is not this project); a matching `ESTABLISHED`
pair means the plugin is attached. `SYN_SENT` means the plugin is retrying against a port with
nothing on it. No socket at all means the plugin is dialing some other port — check its **Relay:**
row.

Figma's Development menu lists plugins by name. Keep exactly one **Figma Design Relay**, imported
from the main checkout's `plugin/manifest.json`, and one **Figma Design Relay (Dev: <name>)** per
live worktree, imported from that worktree's `plugin/dist/manifest.json`. Two imports under one name
means an old worktree was not torn down. A probe with a bogus `nodeId` tells an old build from a
current one — old builds ignore it and describe the selection instead.

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
