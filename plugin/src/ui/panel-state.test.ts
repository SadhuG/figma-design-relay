import { describe, expect, test } from "bun:test";
import {
  ActivityLog,
  chipState,
  formatSelection,
  relayAddress,
  relayPort,
  relayRowText,
  retryDelayMs,
  workingLabel,
} from "./panel-state";

describe("formatSelection", () => {
  test("zero", () => expect(formatSelection(0)).toBe("Nothing selected"));
  test("one", () => expect(formatSelection(1)).toBe("1 node"));
  test("many", () => expect(formatSelection(3)).toBe("3 nodes"));
});

describe("relayAddress", () => {
  test("keeps the connection type, drops the path", () =>
    expect(relayAddress("ws://localhost:1994/ws")).toBe("ws://localhost:1994"));
  test("dev slot port", () =>
    expect(relayAddress("ws://localhost:1999/ws")).toBe("ws://localhost:1999"));
  test("unparseable input comes back as is", () =>
    expect(relayAddress("not a url")).toBe("not a url"));
});

describe("relayPort", () => {
  test("reads the port", () => expect(relayPort("ws://localhost:1994/ws")).toBe("1994"));
  test("unparseable input gives an empty string", () => expect(relayPort("not a url")).toBe(""));
});

describe("relayRowText", () => {
  test("connected", () =>
    expect(relayRowText("ws://localhost:1994", true)).toBe("ws://localhost:1994"));
  test("disconnected", () =>
    expect(relayRowText("ws://localhost:1994", false)).toBe("ws://localhost:1994 (no answer)"));
});

describe("retryDelayMs", () => {
  test("follows the schedule", () =>
    expect([0, 1, 2, 3, 4].map(retryDelayMs)).toEqual([1000, 2000, 5000, 10000, 30000]));
  test("stays at 30 s", () => expect(retryDelayMs(12)).toBe(30000));
});

describe("chipState", () => {
  const base = { connected: true, port: "1994", workingLabel: null, retryInSeconds: null };
  test("live", () =>
    expect(chipState(base)).toEqual({
      tone: "live",
      text: "Live on port 1994",
      short: "Live · 1994",
    }));
  test("working", () =>
    expect(chipState({ ...base, workingLabel: "Agent working" })).toEqual({
      tone: "working",
      text: "Agent working",
      short: "Agent working",
    }));
  test("lost with countdown", () =>
    expect(chipState({ ...base, connected: false, retryInSeconds: 5 })).toEqual({
      tone: "lost",
      text: "Lost the relay · retrying in 5 s",
      short: "Retrying…",
    }));
  test("lost mid-attempt", () =>
    expect(chipState({ ...base, connected: false, retryInSeconds: 0 }).text).toBe(
      "Lost the relay · retrying…"
    ));
  test("lost beats working", () =>
    expect(
      chipState({ ...base, connected: false, workingLabel: "Agent working", retryInSeconds: null })
        .tone
    ).toBe("lost"));
});

describe("ActivityLog", () => {
  test("in-flight request counts however long it runs", () => {
    const log = new ActivityLog();
    log.start("1", null, 0);
    expect(log.activeAgents(60_000)).toEqual([null]);
  });
  test("finished request counts for 10 s, then drops", () => {
    const log = new ActivityLog();
    log.start("1", null, 0);
    log.finish("1", 1_000);
    expect(log.activeAgents(10_999)).toEqual([null]);
    expect(log.activeAgents(11_000)).toEqual([]);
  });
  test("distinct agents", () => {
    const log = new ActivityLog();
    log.start("1", "claude-code", 0);
    log.start("2", "claude-code", 0);
    log.start("3", "cursor-vscode", 0);
    expect(log.activeAgents(1)).toEqual(["claude-code", "cursor-vscode"]);
  });
  test("unknown request id is ignored", () => {
    const log = new ActivityLog();
    log.finish("nope", 0);
    expect(log.activeAgents(0)).toEqual([]);
  });
  test("clear drops in-flight requests", () => {
    const log = new ActivityLog();
    log.start("1", null, 0);
    log.clear();
    expect(log.activeAgents(1)).toEqual([]);
  });
  test("nextExpiry", () => {
    const log = new ActivityLog();
    log.start("1", null, 0);
    expect(log.nextExpiry(0)).toBeNull();
    log.finish("1", 2_000);
    expect(log.nextExpiry(5_000)).toBe(7_000);
  });
});

describe("workingLabel", () => {
  test("idle", () => expect(workingLabel([])).toBeNull());
  test("unnamed", () => expect(workingLabel([null])).toBe("Agent working"));
  test("named", () => expect(workingLabel(["Claude Code"])).toBe("Claude Code is working"));
  test("two", () => expect(workingLabel(["Claude Code", null])).toBe("2 agents working"));
});
