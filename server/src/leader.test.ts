import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Leader } from "./leader.js";

/**
 * The /rpc endpoint executes arbitrary Plugin API code via run_script, so the
 * two guards below are load-bearing: nothing off this machine may reach it, and
 * no web page the user happens to visit may drive it from their browser.
 */
describe("Leader listener", () => {
  let leader: Leader;
  let origin: string;

  beforeAll(async () => {
    leader = new Leader(0);
    await leader.start();
    const address = leader.address();
    if (address === null) throw new Error("leader did not bind");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    leader.stop();
  });

  test("binds the loopback interface, not every interface", () => {
    expect(leader.address()?.address).toBe("127.0.0.1");
  });

  test("answers a follower's well-formed /rpc call", async () => {
    const res = await fetch(`${origin}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "list_files" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  test("rejects an /rpc call that carries an Origin header", async () => {
    const res = await fetch(`${origin}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ tool: "list_files" }),
    });
    expect(res.status).toBe(403);
  });

  test("rejects an /rpc call whose content type a browser form could forge", async () => {
    const res = await fetch(`${origin}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ tool: "list_files" }),
    });
    expect(res.status).toBe(415);
  });

  test("sends no CORS headers that would let a browser read a reply", async () => {
    const res = await fetch(`${origin}/ping`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
