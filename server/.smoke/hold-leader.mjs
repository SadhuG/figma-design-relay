// Holds a long-lived relay server on the smoke-test port.
//
// probe.mjs and call.mjs spawn their own server per invocation and exit when
// the call returns, so nothing would be listening between probes and the
// plugin's WebSocket would have nothing to hold. This process keeps a leader
// alive for the plugin to attach to; each probe then loses the election,
// becomes a follower, and proxies to this one over HTTP /rpc.
//
// If something already holds the port — normally the MCP client's own relay —
// this process would only become a second follower, which is useless and
// misleading. It detects that from the child's startup log and exits with a
// message instead of claiming to be the leader.
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PORT } from "./port.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(here, "../dist/index.js")],
  env: { ...process.env, FIGMA_DESIGN_RELAY_PORT: PORT },
  stderr: "pipe",
});

await transport.start();
transport.stderr?.on("data", (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text);
  if (text.includes("Became FOLLOWER")) {
    console.error(
      `\nPort ${PORT} already has a leader (probably your MCP client's relay). ` +
        `Probes can use it directly — no holder needed — or set SMOKE_PORT to an isolated port ` +
        `and rebuild the plugin for it. See .smoke/README.md.`
    );
    process.exit(2);
  }
  if (text.includes("Became LEADER")) {
    console.log(`holding leader on port ${PORT} (pid ${transport.pid}) — ctrl-c to stop`);
  }
});

// Keep the event loop alive; the child dies with us.
setInterval(() => {}, 1 << 30);
