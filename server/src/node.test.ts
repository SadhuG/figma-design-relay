import { expect, spyOn, test } from "bun:test";
import { Leader } from "./leader.js";
import { Node } from "./node.js";

test("failed leader attempts release their heartbeat intervals", async () => {
  const leader = new Leader(0);
  await leader.start();
  const node = new Node(leader.address()!.port);
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const active = new Set<ReturnType<typeof setInterval>>();
  const set = spyOn(globalThis, "setInterval").mockImplementation(((...args: any[]) => {
    const timer = (originalSetInterval as any)(...args);
    active.add(timer);
    return timer;
  }) as typeof setInterval);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation((timer) => {
    active.delete(timer as ReturnType<typeof setInterval>);
    originalClearInterval(timer);
  });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(node.becomeLeader()).rejects.toThrow("already in use");
    }
    node.stop();
    expect(active.size).toBe(0);
  } finally {
    set.mockRestore();
    clear.mockRestore();
    active.forEach(originalClearInterval);
    node.stop();
    leader.stop();
  }
});
