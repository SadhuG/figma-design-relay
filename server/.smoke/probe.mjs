// Smoke-test harness for run_script (Task 7, R2/R3/R6/R7).
//
// Spawns the worktree server on an isolated port so it wins its own leader
// election instead of joining the stock relay's on 1994, then drives it over
// stdio exactly the way an MCP client would.
//
// Usage: node .smoke/probe.mjs <script-file-or-literal>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.js");
const PORT = process.env.SMOKE_PORT ?? "1995";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node .smoke/probe.mjs <script-file-or-literal>");
  process.exit(2);
}
const code = existsSync(arg) ? readFileSync(arg, "utf8") : arg;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, FIGMA_DESIGN_RELAY_PORT: PORT },
  stderr: "pipe",
});

const client = new Client({ name: "run-script-smoke", version: "0.0.0" }, { capabilities: {} });

let exitCode = 0;
try {
  await client.connect(transport);

  const tools = await client.listTools();
  const advertised = tools.tools.map((t) => t.name);
  if (!advertised.includes("run_script")) {
    console.error("FAIL: server does not advertise run_script; got:", advertised.join(", "));
    process.exit(1);
  }

  console.log("--- script ---");
  console.log(code.trim());
  console.log("--- result ---");

  const result = await client.callTool({ name: "run_script", arguments: { code } });

  // isError distinguishes R6's error channel from a success payload that merely
  // describes a failure. Print it explicitly so the distinction is visible.
  console.log("isError:", result.isError === true);
  for (const block of result.content ?? []) {
    console.log(block.type === "text" ? block.text : JSON.stringify(block));
  }
  exitCode = result.isError === true ? 1 : 0;
} catch (error) {
  console.error("HARNESS ERROR:", error?.message ?? error);
  exitCode = 3;
} finally {
  await client.close().catch(() => {});
}
process.exit(exitCode);
