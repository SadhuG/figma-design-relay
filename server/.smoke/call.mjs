// Generic smoke probe: call any tool with JSON arguments.
//
// Same wiring as probe.mjs — spawns the built server on the smoke-test port and
// joins the leader there as a follower — but takes a tool name and an arguments
// object instead of a script. Image blocks are summarised rather than printed,
// since a base64 PNG is not something you can read in a terminal.
//
// Usage: node .smoke/call.mjs <tool> [json-args]
//   node .smoke/call.mjs get_design_context
//   node .smoke/call.mjs get_design_context '{"format":"css","assetDir":"tmp-assets"}'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PORT } from "./port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.js");

const [toolName, rawArgs] = process.argv.slice(2);
if (!toolName) {
  console.error("usage: node .smoke/call.mjs <tool> [json-args]");
  process.exit(2);
}
const args = rawArgs ? JSON.parse(rawArgs) : {};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, FIGMA_DESIGN_RELAY_PORT: PORT },
  stderr: "pipe",
});

const client = new Client({ name: "tool-smoke", version: "0.0.0" }, { capabilities: {} });

let exitCode = 0;
try {
  await client.connect(transport);

  const tools = await client.listTools();
  const advertised = tools.tools.map((t) => t.name);
  if (!advertised.includes(toolName)) {
    console.error(`FAIL: server does not advertise ${toolName}; got:`, advertised.join(", "));
    process.exit(1);
  }

  console.log(`--- call (port ${PORT}) ---`);
  console.log(toolName, JSON.stringify(args));
  console.log("--- result ---");

  // Match the bridge's 180 s request timeout rather than the SDK's 60 s default.
  const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
    timeout: 180_000,
  });

  console.log("isError:", result.isError === true);
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      console.log(`[text ${block.text.length} chars]`);
      console.log(block.text);
    } else if (block.type === "image") {
      const bytes = Buffer.from(block.data, "base64").length;
      console.log(`[image ${block.mimeType} ${bytes} bytes]`);
    } else {
      console.log(JSON.stringify(block));
    }
  }
  exitCode = result.isError === true ? 1 : 0;
} catch (error) {
  console.error("HARNESS ERROR:", error?.message ?? error);
  exitCode = 3;
} finally {
  await client.close().catch(() => {});
}
process.exit(exitCode);
