import { describe, expect, test } from "bun:test";
import { FOLLOWER_STALE_MS, FollowerRegistry, INSTANCE_ID, readInstance } from "./followers.js";

describe("readInstance", () => {
  test("accepts a process id", () => expect(readInstance("4242")).toBe("4242"));
  test("refuses anything else", () => {
    expect(readInstance(undefined)).toBeNull();
    expect(readInstance("")).toBeNull();
    expect(readInstance("abc")).toBeNull();
    expect(readInstance("12345678901")).toBeNull();
    expect(readInstance(["1", "2"])).toBeNull();
  });
  test("this process names itself by its pid", () => expect(INSTANCE_ID).toBe(String(process.pid)));
});

describe("FollowerRegistry", () => {
  test("counts each instance once", () => {
    const registry = new FollowerRegistry(() => 0);
    registry.touch("1");
    registry.touch("1");
    registry.touch("2");
    expect(registry.count()).toBe(2);
  });
  test("ignores a request with no instance", () => {
    const registry = new FollowerRegistry(() => 0);
    registry.touch(null);
    expect(registry.count()).toBe(0);
  });
  test("an instance not heard from for a minute drops out", () => {
    let clock = 0;
    const registry = new FollowerRegistry(() => clock);
    registry.touch("1");
    clock = FOLLOWER_STALE_MS - 1;
    registry.touch("2");
    expect(registry.count()).toBe(2);
    clock = FOLLOWER_STALE_MS + 1;
    expect(registry.count()).toBe(1);
  });
});
