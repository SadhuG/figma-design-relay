// The one place the smoke harness reads its port from.
//
// SMOKE_PORT if set; else, in a feature worktree, its dev slot's port (the
// port that worktree's plugin build and server use); else the stable 1994 —
// the port the MCP client's own server and a stable plugin build both use —
// so the harness joins that relay as a follower with no special setup.
import { existsSync, readFileSync } from "node:fs";

function slotPort() {
  const file = new URL("../../.dev-slot.json", import.meta.url);
  if (!existsSync(file)) return undefined; // the stable checkout
  // A broken slot must not quietly send probes to the stable relay.
  let port;
  try {
    port = JSON.parse(readFileSync(file, "utf8")).port;
  } catch {
    throw new Error(
      `.dev-slot.json is not valid JSON. Delete it and run bun scripts/dev-slot.mjs.`
    );
  }
  // Same range the server enforces (src/port.ts), so 1994 is never a slot.
  if (!Number.isInteger(port) || port < 1995 || port > 2019) {
    throw new Error(
      `.dev-slot.json needs an integer port between 1995 and 2019. Delete it and run bun scripts/dev-slot.mjs.`
    );
  }
  return String(port);
}

export const PORT = process.env.SMOKE_PORT ?? slotPort() ?? "1994";
