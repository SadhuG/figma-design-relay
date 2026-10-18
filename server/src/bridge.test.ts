import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Leader } from "./leader.js";
import { Node } from "./node.js";
import { WebSocket } from "ws";

let leader: Leader;
let sockets: WebSocket[];
beforeEach(async () => {
  sockets = [];
  leader = new Leader(0);
  await leader.start();
});
afterEach(() => {
  sockets.forEach((socket) => socket.terminate());
  leader.stop();
});

async function connect(fileKey: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${leader.address()!.port}/ws?fileKey=${fileKey}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

test("only the addressed socket can resolve a request", async () => {
  const target = await connect("target");
  const other = await connect("other");
  const received = new Promise<string>((resolve) =>
    target.once("message", (data) => resolve(data.toString()))
  );
  const result = leader.getBridge().send("get_node", ["1:1"], "target");
  const request = JSON.parse(await received);
  other.send(JSON.stringify({ ...request, data: "forged" }));
  // A frame on the other socket is ordered after its forged response.
  await new Promise<void>((resolve) => {
    other.once("pong", () => resolve());
    other.ping();
  });
  target.send(JSON.stringify({ ...request, data: "correct" }));
  expect((await result).data).toBe("correct");
});

test("ignores malformed responses without losing the pending request", async () => {
  const target = await connect("target");
  const received = new Promise<string>((resolve) =>
    target.once("message", (data) => resolve(data.toString()))
  );
  const result = leader.getBridge().send("get_node", ["1:1"], "target");
  const request = JSON.parse(await received);
  target.send(JSON.stringify({ requestId: request.requestId, type: 7, error: {} }));
  target.send(JSON.stringify({ ...request, data: "correct" }));
  expect((await result).data).toBe("correct");
});

/** Resolves with the next request the fake plugin socket receives, and answers it. */
function nextRequest(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) =>
    socket.once("message", (data) => {
      const request = JSON.parse(data.toString());
      socket.send(JSON.stringify({ type: request.type, requestId: request.requestId, data: "ok" }));
      resolve(request);
    })
  );
}

async function rpc(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${leader.address()!.port}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the calling agent's name", () => {
  test("the bridge sends it to the plugin", async () => {
    const plugin = await connect("target");
    const received = nextRequest(plugin);
    await leader
      .getBridge()
      .sendWithParams("get_selection", undefined, undefined, "target", "claude-code");
    expect((await received).agent).toBe("claude-code");
  });

  test("the bridge sends no agent key when it has none", async () => {
    const plugin = await connect("target");
    const received = nextRequest(plugin);
    await leader.getBridge().sendWithParams("get_selection", undefined, undefined, "target");
    expect("agent" in (await received)).toBe(false);
  });

  test("a follower's /rpc agent reaches the plugin", async () => {
    const plugin = await connect("target");
    const received = nextRequest(plugin);
    const res = await rpc({ tool: "get_selection", fileKey: "target", agent: "cursor-vscode" });
    expect(await res.json()).toEqual({ data: "ok" });
    expect((await received).agent).toBe("cursor-vscode");
  });

  test("a malformed /rpc agent is dropped, and the call still runs", async () => {
    const plugin = await connect("target");
    const received = nextRequest(plugin);
    const res = await rpc({ tool: "get_selection", fileKey: "target", agent: { evil: true } });
    expect(await res.json()).toEqual({ data: "ok" });
    expect("agent" in (await received)).toBe(false);
  });

  test("an /rpc call without an agent still runs", async () => {
    const plugin = await connect("target");
    const received = nextRequest(plugin);
    const res = await rpc({ tool: "get_selection", fileKey: "target" });
    expect(await res.json()).toEqual({ data: "ok" });
    expect("agent" in (await received)).toBe(false);
  });

  test("a follower Node posts its agent name to the leader", async () => {
    const plugin = await connect("target");
    const received = nextRequest(plugin);
    const node = new Node(leader.address()!.port);
    node.setAgentName("  claude-code\n");
    await node.sendWithParams("get_selection", undefined, undefined, "target");
    expect((await received).agent).toBe("claude-code");
  });

  test("a leader Node hands its agent name to its own bridge", async () => {
    const node = new Node(0);
    await node.becomeLeader();
    try {
      const port = (node as unknown as { leader: Leader }).leader.address()!.port;
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?fileKey=own`);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const received = nextRequest(socket);
      node.setAgentName("codex-mcp-client");
      await node.sendWithParams("get_selection", undefined, undefined, "own");
      expect((await received).agent).toBe("codex-mcp-client");
    } finally {
      node.stop();
    }
  });
});

// The panel's "Leader · 2 followers": the count goes only to plugins that ask for it.
describe("relay-status", () => {
  async function connectWith(query: string): Promise<{ socket: WebSocket; received: unknown[] }> {
    const socket = new WebSocket(`ws://127.0.0.1:${leader.address()!.port}/ws?${query}`);
    sockets.push(socket);
    const received: unknown[] = [];
    socket.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return { socket, received };
  }
  /** Waits until every frame the server sent before now has arrived. */
  const settle = (socket: WebSocket) =>
    new Promise<void>((resolve) => {
      socket.once("pong", () => resolve());
      socket.ping();
    });

  test("an opted-in plugin gets the count on connect and on every change", async () => {
    const { socket, received } = await connectWith("fileKey=a&relayStatus=1");
    leader.getBridge().setFollowerCount(2);
    await settle(socket);
    expect(received).toEqual([
      { type: "relay-status", followers: 0 },
      { type: "relay-status", followers: 2 },
    ]);
  });

  test("a plugin that didn't ask gets nothing", async () => {
    const { socket, received } = await connectWith("fileKey=b");
    leader.getBridge().setFollowerCount(3);
    await settle(socket);
    expect(received).toEqual([]);
  });

  test("an unchanged count is not sent again", async () => {
    const { socket, received } = await connectWith("fileKey=c&relayStatus=1");
    leader.getBridge().setFollowerCount(1);
    leader.getBridge().setFollowerCount(1);
    await settle(socket);
    expect(received).toEqual([
      { type: "relay-status", followers: 0 },
      { type: "relay-status", followers: 1 },
    ]);
  });

  test("a follower's ping raises the count the plugin sees", async () => {
    const { socket, received } = await connectWith("fileKey=d&relayStatus=1");
    await fetch(`http://127.0.0.1:${leader.address()!.port}/ping`, {
      headers: { "x-relay-instance": "4242" },
    });
    await fetch(`http://127.0.0.1:${leader.address()!.port}/ping`);
    await settle(socket);
    expect(received).toEqual([
      { type: "relay-status", followers: 0 },
      { type: "relay-status", followers: 1 },
    ]);
  });
});
