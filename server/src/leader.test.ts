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

/**
 * Since phase 6 the plugin runs in FigJam and Slides too, and which tools work
 * depends on the editor — so list_files says which editor each file is open in.
 */
describe("list_files reports the editor", () => {
  let leader: Leader;
  let port: number;

  beforeAll(async () => {
    leader = new Leader(0);
    await leader.start();
    const address = leader.address();
    if (address === null) throw new Error("leader did not bind");
    port = address.port;
  });

  afterAll(() => {
    leader.stop();
  });

  const connect = (query: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);
      socket.onopen = () => resolve(socket);
      socket.onerror = () => reject(new Error("plugin socket failed to open"));
    });

  const listFiles = async (): Promise<unknown> => {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "list_files" }),
    });
    return ((await res.json()) as { data: unknown }).data;
  };

  // The server registers the socket on the upgrade, a tick after the client's
  // open event, and drops a closed one just as lazily — so poll for the file
  // this test connected, never a count another test's socket could satisfy.
  const waitForFile = async (fileKey: string): Promise<Record<string, unknown>> => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const files = (await listFiles()) as Array<Record<string, unknown>>;
      const file = files.find((entry) => entry.fileKey === fileKey);
      if (file) return file;
      await Bun.sleep(10);
    }
    throw new Error(`expected ${fileKey} to be connected`);
  };

  test("carries the editorType the plugin connected with", async () => {
    const socket = await connect("fileKey=board&fileName=Board&editorType=figjam");
    try {
      expect(await waitForFile("board")).toEqual({
        fileKey: "board",
        fileName: "Board",
        editorType: "figjam",
      });
    } finally {
      socket.close();
    }
  });

  test("omits an editorType it does not recognise", async () => {
    const socket = await connect("fileKey=odd&fileName=Odd&editorType=bogus");
    try {
      expect(await waitForFile("odd")).toEqual({ fileKey: "odd", fileName: "Odd" });
    } finally {
      socket.close();
    }
  });
});
