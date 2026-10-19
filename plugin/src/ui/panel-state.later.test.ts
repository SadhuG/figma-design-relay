// Rules for Board 10's "Later" states: 04 Selection sent, 05 Syncing layers,
// 06 Diagram drawn and 08 Leader and followers.
import { describe, expect, test } from "bun:test";
import {
  DIAGRAM_WINDOW_MS,
  NoticeBoard,
  ReadProgressLog,
  SENT_WINDOW_MS,
  SYNC_DELAY_MS,
  WORKING_WINDOW_MS,
  chipState,
  sameNodes,
  selectionRowText,
} from "./panel-state";

describe("chipState for the later states", () => {
  const base = { connected: true, port: "1994", workingLabel: null, retryInSeconds: null };

  test("syncing", () =>
    expect(chipState({ ...base, syncingPercent: 62 })).toEqual({
      tone: "syncing",
      text: "Reading the layer tree… 62%",
      short: "Syncing 62%",
    }));
  test("syncing beats working and diagram", () =>
    expect(
      chipState({ ...base, syncingPercent: 5, workingLabel: "Agent working", notice: "diagram" })
        .tone
    ).toBe("syncing"));
  test("diagram", () =>
    expect(chipState({ ...base, notice: "diagram" })).toEqual({
      tone: "diagram",
      text: "Diagram drawn on this page",
      short: "Diagram drawn",
    }));
  test("diagram beats working", () =>
    expect(chipState({ ...base, notice: "diagram", workingLabel: "Agent working" }).tone).toBe(
      "diagram"
    ));
  test("sent", () =>
    expect(chipState({ ...base, notice: "sent" })).toEqual({
      tone: "sent",
      text: "Sent to your agent",
      short: "Sent",
    }));
  test("working beats sent", () =>
    expect(chipState({ ...base, notice: "sent", workingLabel: "Agent working" }).tone).toBe(
      "working"
    ));
  test("two followers", () =>
    expect(chipState({ ...base, followers: 2 })).toEqual({
      tone: "leader",
      text: "Leader · 2 followers",
      short: "Leader +2",
    }));
  test("one follower", () =>
    expect(chipState({ ...base, followers: 1 })).toEqual({
      tone: "leader",
      text: "Leader · 1 follower",
      short: "Leader +1",
    }));
  test("no followers stays Live", () =>
    expect(chipState({ ...base, followers: 0 }).tone).toBe("live"));
  test("sent beats leader", () =>
    expect(chipState({ ...base, followers: 2, notice: "sent" }).tone).toBe("sent"));
  test("lost beats every later state", () =>
    expect(
      chipState({
        ...base,
        connected: false,
        syncingPercent: 50,
        notice: "diagram",
        followers: 3,
      }).tone
    ).toBe("lost"));
  test("connecting beats every later state", () =>
    expect(
      chipState({ ...base, connected: false, connecting: true, syncingPercent: 50 }).tone
    ).toBe("connecting"));
});

/** A board that has seen these requests start on the current socket. */
const boardWith = (...requestIds: string[]) => {
  const board = new NoticeBoard();
  for (const id of requestIds) board.requestStarted(id, 0);
  return board;
};

describe("NoticeBoard: sent", () => {
  test("stays while its request runs, however long", () => {
    const board = boardWith("r1");
    board.record("sent", "r1", ["1:2"], 0);
    expect(board.current(120_000).sent?.nodeIds).toEqual(["1:2"]);
  });
  test("expires working window + sent window after its request finishes", () => {
    const board = boardWith("r1");
    board.record("sent", "r1", ["1:2"], 0);
    board.requestFinished("r1", 1_000);
    const end = 1_000 + WORKING_WINDOW_MS + SENT_WINDOW_MS;
    expect(board.current(end - 1).sent).not.toBeNull();
    expect(board.current(end).sent).toBeNull();
  });
  test("a later finish pushes the expiry out", () => {
    const board = boardWith("r1");
    board.record("sent", "r1", ["1:2"], 0);
    board.requestFinished("r1", 1_000);
    board.requestStarted("r2", 5_000);
    board.requestFinished("r2", 8_000);
    expect(board.current(8_000 + WORKING_WINDOW_MS + SENT_WINDOW_MS - 1).sent).not.toBeNull();
  });
  test("an event that arrives after its own response still gets an expiry", () => {
    const board = boardWith("r1");
    board.requestFinished("r1", 1_000);
    board.record("sent", "r1", ["1:2"], 1_001);
    expect(board.nextExpiry(1_001)).toBe(WORKING_WINDOW_MS + SENT_WINDOW_MS - 1);
  });
  test("a new record replaces the old one", () => {
    const board = boardWith("r1", "r2");
    board.record("sent", "r1", ["1:2"], 0);
    board.record("sent", "r2", ["3:4"], 10);
    expect(board.current(20).sent?.requestId).toBe("r2");
  });
  test("another request starting does not clear it", () => {
    const board = boardWith("r1");
    board.record("sent", "r1", ["1:2"], 0);
    board.requestStarted("r2", 10);
    expect(board.current(20).sent).not.toBeNull();
  });
});

describe("NoticeBoard: diagram", () => {
  test("lasts 60 s from when it was drawn", () => {
    const board = boardWith("r1");
    board.record("diagram", "r1", ["5:6"], 1_000);
    board.requestFinished("r1", 1_100);
    expect(board.current(1_000 + DIAGRAM_WINDOW_MS - 1).diagram).not.toBeNull();
    expect(board.current(1_000 + DIAGRAM_WINDOW_MS).diagram).toBeNull();
  });
  test("another request starting clears it", () => {
    const board = boardWith("r1");
    board.record("diagram", "r1", ["5:6"], 0);
    board.requestStarted("r2", 10);
    expect(board.current(20).diagram).toBeNull();
  });
  test("dismiss clears it", () => {
    const board = boardWith("r1");
    board.record("diagram", "r1", ["5:6"], 0);
    board.dismiss("diagram");
    expect(board.current(1).diagram).toBeNull();
  });
  test("clear drops both kinds", () => {
    const board = boardWith("r1", "r2");
    board.record("diagram", "r1", ["5:6"], 0);
    board.record("sent", "r2", ["1:2"], 0);
    board.clear();
    expect(board.current(1)).toEqual({ diagram: null, sent: null });
  });
  test("nextExpiry is the nearest clock", () => {
    const board = boardWith("r1", "r2");
    board.record("diagram", "r1", ["5:6"], 0);
    board.record("sent", "r2", ["1:2"], 0);
    board.requestFinished("r2", 0);
    expect(board.nextExpiry(0)).toBe(WORKING_WINDOW_MS + SENT_WINDOW_MS);
  });
  test("nextExpiry is null with no clock running", () => {
    const board = boardWith("r1");
    board.record("sent", "r1", ["1:2"], 0);
    expect(board.nextExpiry(0)).toBeNull();
  });
});

// The socket can drop while the main thread is still working on a request; its late event and
// response must not bring a notice back for an answer the agent never got.
describe("NoticeBoard: requests from a closed socket", () => {
  test("ignores events for a request it never saw start", () => {
    const board = new NoticeBoard();
    board.record("sent", "r9", ["1:2"], 0);
    board.record("diagram", "r9", ["5:6"], 0);
    expect(board.current(1)).toEqual({ diagram: null, sent: null });
  });
  test("after clear, a late event and response for an old request change nothing", () => {
    for (const kind of ["sent", "diagram"] as const) {
      const board = boardWith("r1");
      board.clear();
      board.record(kind, "r1", ["1:2"], 10);
      board.requestFinished("r1", 20);
      board.requestStarted("r2", 30);
      expect(board.current(40)).toEqual({ diagram: null, sent: null });
    }
  });
  test("a late response for an old request doesn't extend a new sent notice", () => {
    const board = boardWith("r1");
    board.clear();
    board.requestStarted("r2", 0);
    board.record("sent", "r2", ["1:2"], 0);
    board.requestFinished("r2", 1_000);
    board.requestFinished("r1", 5_000);
    expect(board.current(1_000 + WORKING_WINDOW_MS + SENT_WINDOW_MS).sent).toBeNull();
  });
});

describe("ReadProgressLog", () => {
  test("hidden for the first 500 ms", () => {
    const log = new ReadProgressLog();
    log.start("r1", 0);
    log.progress("r1", 40);
    expect(log.percent(SYNC_DELAY_MS - 1)).toBeNull();
    expect(log.percent(SYNC_DELAY_MS)).toBe(40);
  });
  test("hidden until a percent arrives", () => {
    const log = new ReadProgressLog();
    log.start("r1", 0);
    expect(log.percent(5_000)).toBeNull();
  });
  test("gone once finished", () => {
    const log = new ReadProgressLog();
    log.start("r1", 0);
    log.progress("r1", 40);
    log.finish("r1");
    expect(log.percent(5_000)).toBeNull();
  });
  test("progress for an unknown read is ignored", () => {
    const log = new ReadProgressLog();
    log.progress("r9", 40);
    expect(log.percent(5_000)).toBeNull();
  });
  test("lowest percent of the visible reads, floored and clamped", () => {
    const log = new ReadProgressLog();
    log.start("r1", 0);
    log.start("r2", 0);
    log.progress("r1", 72.9);
    log.progress("r2", 140);
    expect(log.percent(1_000)).toBe(72);
    log.progress("r1", -5);
    expect(log.percent(1_000)).toBe(0);
  });
  test("nextReveal counts down to the 500 ms mark", () => {
    const log = new ReadProgressLog();
    log.start("r1", 100);
    expect(log.nextReveal(300)).toBe(300);
    expect(log.nextReveal(700)).toBeNull();
  });
  test("clear drops every read", () => {
    const log = new ReadProgressLog();
    log.start("r1", 0);
    log.progress("r1", 10);
    log.clear();
    expect(log.percent(1_000)).toBeNull();
  });
});

describe("selection row", () => {
  test("plain", () => expect(selectionRowText(3, false)).toBe("3 nodes"));
  test("just sent", () => expect(selectionRowText(3, true)).toBe("3 nodes · sent just now"));
  test("one node sent", () => expect(selectionRowText(1, true)).toBe("1 node · sent just now"));
  test("sameNodes ignores order", () =>
    expect(sameNodes(["1:2", "3:4"], ["3:4", "1:2"])).toBe(true));
  test("sameNodes sees a difference", () => expect(sameNodes(["1:2"], ["1:2", "3:4"])).toBe(false));
  test("sameNodes with nothing sent is false", () => expect(sameNodes([], [])).toBe(false));
});
