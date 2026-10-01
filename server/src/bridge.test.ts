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
