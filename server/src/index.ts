#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Node } from "./node.js";
import { Election } from "./election.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";
import { readSlotPort, resolvePort } from "./port.js";
import { fileURLToPath } from "node:url";

// A feature worktree's server runs on its dev slot's port (see port.ts), so
// it never joins the stable relay's leader election on 1994. The plugin built
// in the same worktree dials the same port.
function startupPort(): number {
  try {
    const slot = readSlotPort(fileURLToPath(new URL("../../.dev-slot.json", import.meta.url)));
    return resolvePort(process.env.FIGMA_DESIGN_RELAY_PORT, slot);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
const PORT = startupPort();

async function main(): Promise<void> {
  const node = new Node(PORT);
  const election = new Election(PORT, node);
  await election.start();

  let transport: StdioServerTransport | null = null;
  let shuttingDown = false;
  const shutdown = async (reason: string, code: number = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`Shutting down (${reason})...`);

    const force = setTimeout(() => {
      console.error("Shutdown timeout exceeded, forcing exit");
      process.exit(code);
    }, 5000);
    force.unref();

    election.stop();
    node.stop();
    if (transport) {
      try {
        await transport.close();
      } catch (err) {
        console.error("Transport close error:", err);
      }
    }
    process.exit(code);
  };

  process.stdin.on("end", () => void shutdown("stdin end"));
  process.stdin.on("close", () => void shutdown("stdin close"));

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));

  process.on("uncaughtException", async (err) => {
    console.error("Uncaught exception:", err);
    await shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
  });

  const server = new McpServer({
    name: "figma-design-relay",
    version: VERSION,
  });

  registerTools(server, node, PORT);

  console.error(`Starting MCP server (role: ${node.roleName})`);

  transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
