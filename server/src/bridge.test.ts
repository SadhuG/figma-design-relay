import { afterEach, beforeEach, expect, test } from "bun:test";
import { Leader } from "./leader.js";
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
  await bridge.sendWithParams("get_screenshot", ["9:9"], undefined, "target", {
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
