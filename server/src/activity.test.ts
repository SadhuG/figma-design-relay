import { describe, expect, test } from "bun:test";
import {
  ActivityLog,
  ERROR_TEXT_LIMIT,
  FOLLOWER_STALE_MS,
  FollowerRegistry,
  readInstance,
} from "./activity.js";

function clock(start = 1_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => void (time += ms) };
}

describe("ActivityLog", () => {
  test("records a finished call with its duration, newest first", () => {
    const c = clock();
    const log = new ActivityLog(200, c.now);
    const first = log.start("get_node", { kind: "local" }, { fileKey: "k", fileName: "Screen" });
    c.advance(40);
    first();
    log.start(
      "get_selection",
      { kind: "follower", instance: "4242" },
      null
    )("No plugin connected.");
    expect(log.recent()).toEqual([
      {
        id: 2,
        tool: "get_selection",
        fileKey: null,
        fileName: null,
        origin: { kind: "follower", instance: "4242" },
        startedAt: 1_040,
        durationMs: 0,
        ok: false,
        error: "No plugin connected.",
      },
      {
        id: 1,
        tool: "get_node",
        fileKey: "k",
        fileName: "Screen",
        origin: { kind: "local" },
        startedAt: 1_000,
        durationMs: 40,
        ok: true,
      },
    ]);
  });

  test("keeps only the newest entries once full", () => {
    const log = new ActivityLog(3);
    for (let i = 0; i < 5; i++) log.start(`tool_${i}`, { kind: "local" }, null)();
    expect(log.recent().map((entry) => entry.tool)).toEqual(["tool_4", "tool_3", "tool_2"]);
  });

  test("shortens long error text", () => {
    const log = new ActivityLog();
    log.start("run_script", { kind: "local" }, null)("x".repeat(5_000));
    const [entry] = log.recent();
    expect(entry.error).toHaveLength(ERROR_TEXT_LIMIT);
    expect(entry.error!.endsWith("…")).toBe(true);
  });

  test("records a call once even if it is finished twice", () => {
    const log = new ActivityLog();
    const finish = log.start("get_node", { kind: "local" }, null);
    finish();
    finish("late timeout");
    expect(log.recent()).toHaveLength(1);
    expect(log.recent()[0].ok).toBe(true);
  });
});

describe("FollowerRegistry", () => {
  test("bounds distinct follower observations without dashboard reads", () => {
    const c = clock();
    const registry = new FollowerRegistry(c.now);
    for (let i = 0; i < 300; i++) registry.touch(String(i), false);
    const active = registry.active();
    expect(active).toHaveLength(256);
    expect(active.some((entry) => entry.instance === "0")).toBe(false);
    expect(active.some((entry) => entry.instance === "299")).toBe(true);
  });

  test("expires a stale returning follower on observation without a prior snapshot", () => {
    const c = clock();
    const registry = new FollowerRegistry(c.now);
    registry.touch("4242", true);
    c.advance(FOLLOWER_STALE_MS + 1);
    registry.touch("4242", false);
    expect(registry.active()).toEqual([{ instance: "4242", lastSeen: c.now(), calls: 0 }]);
  });

  test("evicts the least recently observed label and preserves refreshed call counts", () => {
    const c = clock();
    const registry = new FollowerRegistry(c.now);
    for (let i = 0; i < 256; i++) registry.touch(String(i), true);
    c.advance(1);
    registry.touch("0", true);
    registry.touch("256", false);
    const active = registry.active();
    expect(active).toHaveLength(256);
    expect(active.find((entry) => entry.instance === "0")?.calls).toBe(2);
    expect(active.some((entry) => entry.instance === "1")).toBe(false);
    expect(active.some((entry) => entry.instance === "256")).toBe(true);
  });

  test("counts calls and forgets followers silent for a minute", () => {
    const c = clock();
    const registry = new FollowerRegistry(c.now);
    registry.touch("4242", false);
    registry.touch("4242", true);
    registry.touch("5151", true);
    c.advance(FOLLOWER_STALE_MS - 1);
    registry.touch("5151", false);
    c.advance(2);
    expect(registry.active()).toEqual([
      { instance: "5151", lastSeen: 1_000 + FOLLOWER_STALE_MS - 1, calls: 1 },
    ]);
  });

  test("ignores requests without an instance", () => {
    const registry = new FollowerRegistry();
    registry.touch(null, true);
    expect(registry.active()).toEqual([]);
  });
});

describe("readInstance", () => {
  test("accepts a process id and nothing else", () => {
    expect(readInstance("4242")).toBe("4242");
    expect(readInstance("abc")).toBeNull();
    expect(readInstance("")).toBeNull();
    expect(readInstance("12345678901")).toBeNull();
    expect(readInstance(["4242"])).toBeNull();
    expect(readInstance(undefined)).toBeNull();
  });
});
