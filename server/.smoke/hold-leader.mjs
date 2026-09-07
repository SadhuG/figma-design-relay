// Holds a long-lived relay server on the isolated smoke-test port.
//
// probe.mjs spawns its own server per invocation and exits when the call
// returns, so nothing was listening on 1995 between probes and the plugin's
// WebSocket had nothing to connect to. This process keeps a leader alive for
// the plugin to hold a socket against; each probe then loses the election,
// becomes a follower, and proxies to this one over HTTP /rpc.
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.SMOKE_PORT ?? "1995";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(here, "../dist/index.js")],
  env: { ...process.env, FIGMA_DESIGN_RELAY_PORT: PORT },
  stderr: "pipe",
});

await transport.start();
transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));

console.log(`leader holding port ${PORT} (pid ${transport.pid}) — ctrl-c to stop`);

// Keep the event loop alive; the child dies with us.
setInterval(() => {}, 1 << 30);
