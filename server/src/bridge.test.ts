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

test("records each call's tool, file, origin and outcome", async () => {
  const target = await connect("target");
  target.on("message", (data) => {
    const request = JSON.parse(data.toString());
    const reply =
      request.type === "get_node"
        ? { ...request, data: "ok" }
        : { ...request, error: "Node not found" };
    target.send(JSON.stringify(reply));
  });
  const bridge = leader.getBridge();
  await bridge.send("get_node", ["1:1"], "target");
  await bridge.sendWithParams("get_screenshot", ["9:9"], undefined, "target", undefined, {
    kind: "follower",
    instance: "4242",
  });
  const [failed, passed] = bridge.getActivity().recent();
  expect(passed).toMatchObject({
    tool: "get_node",
    fileKey: "target",
    fileName: "Unknown",
    origin: { kind: "local" },
    ok: true,
  });
  expect(failed).toMatchObject({
    tool: "get_screenshot",
    origin: { kind: "follower", instance: "4242" },
    ok: false,
    error: "Node not found",
  });
});

test("records a call that could not find its file", async () => {
  const bridge = leader.getBridge();
  await expect(bridge.send("get_node", ["1:1"], "missing")).rejects.toThrow("No plugin connected");
  expect(bridge.getActivity().recent()[0]).toMatchObject({
    tool: "get_node",
    fileKey: null,
    fileName: null,
    ok: false,
  });
});

test("records a call whose plugin disconnected mid-request", async () => {
  const target = await connect("target");
  // Close from a later tick, and let the handshake finish before afterEach:
  // closing a ws client inside its own message handler crashes Bun 1.4.0
  // (segfault) when the next test starts its server.
  target.once("message", () => setTimeout(() => target.close(), 0));
  const closed = new Promise<void>((resolve) => target.once("close", () => resolve()));
  const bridge = leader.getBridge();
  await expect(bridge.send("get_node", ["1:1"], "target")).rejects.toThrow("Plugin disconnected");
  expect(bridge.getActivity().recent()[0]).toMatchObject({ fileKey: "target", ok: false });
  await closed;
});

test("describes each connection with when it connected, list_files unchanged", async () => {
  const before = Date.now();
  await connect("target");
  const bridge = leader.getBridge();
  const [file] = bridge.describeConnections();
  expect(file.fileKey).toBe("target");
  expect(file.connectedAt).toBeGreaterThanOrEqual(before);
  expect(bridge.listConnectedFiles()).toEqual([{ fileKey: "target", fileName: "Unknown" }]);
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
    expect(leader.getBridge().getActivity().recent()[0]).toMatchObject({
      origin: { kind: "follower", instance: null },
      ok: true,
    });
  });

  test("a malformed /rpc agent is dropped, and the call still runs", async () => {
    const plugin = await connect("target");
    const received = nextRequest(plugin);
    const res = await rpc({ tool: "get_selection", fileKey: "target", agent: { evil: true } });
    expect(await res.json()).toEqual({ data: "ok" });
    expect("agent" in (await received)).toBe(false);
  });

  test("save_screenshots preserves the follower origin and agent on its export request", async () => {
    const plugin = await connect("target");
    const received = new Promise<Record<string, unknown>>((resolve) =>
      plugin.once("message", (data) => {
        const request = JSON.parse(data.toString());
        plugin.send(JSON.stringify({ ...request, error: "Export refused" }));
        resolve(request);
      })
    );
    const res = await rpc({
      tool: "save_screenshots",
      fileKey: "target",
      agent: "claude-code",
      params: { items: [{ nodeId: "1:1", outputPath: "dashboard-test.png" }] },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ failed: 1, hasErrors: true });
    expect(await received).toMatchObject({ agent: "claude-code", nodeIds: ["1:1"] });
    expect(leader.getBridge().getActivity().recent()[0]).toMatchObject({
      origin: { kind: "follower", instance: null },
      ok: false,
      error: "Export refused",
    });
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
    expect(leader.getBridge().getActivity().recent()[0]).toMatchObject({
      origin: { kind: "follower", instance: String(process.pid) },
      ok: true,
    });
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
      expect(
        (node as unknown as { leader: Leader }).leader.getBridge().getActivity().recent()[0]
      ).toMatchObject({ origin: { kind: "local" }, ok: true });
    } finally {
      node.stop();
    }
  });
});
