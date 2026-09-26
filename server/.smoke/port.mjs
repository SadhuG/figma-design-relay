// The one place the smoke harness reads its port from.
//
// SMOKE_PORT if set; else, in a feature worktree, its dev slot's port (the
// port that worktree's plugin build and server use); else the stable 1994 —
// the port the MCP client's own server and a stable plugin build both use —
// so the harness joins that relay as a follower with no special setup.
import { readFileSync } from "node:fs";

function slotPort() {
  try {
    return String(JSON.parse(readFileSync(new URL("../../.dev-slot.json", import.meta.url))).port);
  } catch {
    return undefined; // no slot: the stable checkout (the server refuses a broken one)
  }
}

export const PORT = process.env.SMOKE_PORT ?? slotPort() ?? "1994";
