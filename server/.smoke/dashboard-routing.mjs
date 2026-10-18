// Run after `bun run build`: a malformed request must not terminate the Node leader.
// Uses an ephemeral port and never connects to Figma or a worktree's dev relay.
import assert from "node:assert/strict";
import http from "node:http";
import { Leader } from "../dist/leader.js";

const leader = new Leader(0);
await leader.start();
const port = leader.address().port;

async function request(path, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, headers: { Host: host } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

try {
  assert.equal(await request("//"), 400);
  assert.equal(await request("http://[invalid"), 400);
  assert.equal(await request("/ping"), 200);
  assert.equal(await request("/api/status"), 200);
  assert.equal(await request("/api/status", "evil.example"), 403);
  console.log(`${process.version}: malformed targets rejected; leader healthy; host guard intact`);
} finally {
  leader.stop();
}
