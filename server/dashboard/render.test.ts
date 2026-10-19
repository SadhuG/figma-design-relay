import { describe, expect, test } from "bun:test";
import {
  editorLabel,
  escapeHtml,
  formatClock,
  formatDuration,
  relativeTime,
  renderActivity,
  renderFiles,
  renderFollowers,
  renderHeader,
} from "./render.js";

const NOW = new Date(2026, 9, 14, 9, 5, 3).getTime();
const HOSTILE = `<img src=x onerror="alert(1)">`;

function status(overrides: Record<string, unknown> = {}) {
  return {
    version: "0.8.0",
    port: 1994,
    pid: 4100,
    startedAt: NOW - 60_000,
    now: NOW,
    files: [],
    followers: [],
    activity: [],
    ...overrides,
  };
}

function call(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tool: "get_node",
    fileKey: "k1",
    fileName: "Screen",
    origin: { kind: "local" },
    startedAt: NOW - 10_000,
    durationMs: 42,
    ok: true,
    ...overrides,
  };
}

describe("formatting", () => {
  test("escapeHtml escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });

  test("editorLabel names each editor and falls back safely", () => {
    expect(editorLabel("figma")).toBe("Design");
    expect(editorLabel("figjam")).toBe("FigJam");
    expect(editorLabel("slides")).toBe("Slides");
    expect(editorLabel("dev")).toBe("Dev Mode");
    expect(editorLabel(undefined)).toBe("Unknown editor");
    expect(editorLabel("constructor")).toBe("Unknown editor");
  });

  test("durations, clock times and relative times", () => {
    expect(formatDuration(42)).toBe("42 ms");
    expect(formatDuration(1_260)).toBe("1.3 s");
    expect(formatClock(NOW)).toBe("09:05:03");
    expect(relativeTime(NOW - 2_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 30_000, NOW)).toBe("30s ago");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
});

describe("renderHeader", () => {
  test("shows version, port, leader process and start time", () => {
    const html = renderHeader(status());
    expect(html).toContain("v0.8.0");
    expect(html).toContain("port 1994");
    expect(html).toContain("4100");
    expect(html).toContain("09:04:03");
  });
});

describe("renderFiles", () => {
  test("explains how to connect when no file is open, naming the port", () => {
    const html = renderFiles(status());
    expect(html).toContain("No Figma files connected");
    expect(html).toContain("1994");
  });

  test("shows each file's editor, connection time and newest call", () => {
    const html = renderFiles(
      status({
        files: [
          {
            fileKey: "k1",
            fileName: "Screen",
            editorType: "figjam",
            connectedAt: NOW - 120_000,
            lastCallAt: NOW - 30_000,
          },
        ],
        activity: [call({ startedAt: NOW - 90_000 })],
      })
    );
    expect(html).toContain("FigJam");
    expect(html).toContain("Connected 2m ago");
    expect(html).toContain("last call 30s ago");
  });

  test("escapes a hostile file name and error", () => {
    const html =
      renderFiles(status({ files: [{ fileKey: HOSTILE, fileName: HOSTILE, connectedAt: NOW }] })) +
      renderActivity(
        status({ activity: [call({ fileName: HOSTILE, ok: false, error: HOSTILE })] })
      );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("renderActivity", () => {
  test("lists calls with origin, duration and result", () => {
    const html = renderActivity(
      status({
        activity: [
          call({
            ok: false,
            error: "Node not found",
            origin: { kind: "follower", instance: "5151" },
          }),
          call({ fileKey: null, fileName: null }),
        ],
      })
    );
    expect(html).toContain("Follower 5151");
    expect(html).toContain("This relay");
    expect(html).toContain("42 ms");
    expect(html).toContain("Node not found");
    expect(html).toContain("—");
  });

  test("filters to failed calls, with its own empty message", () => {
    const passing = status({ activity: [call()] });
    expect(renderActivity(passing, { errorsOnly: true })).toContain("No failed calls");
    expect(renderActivity(status())).toContain("No tool calls yet");
  });
});

describe("renderFollowers", () => {
  test("explains followers when there are none, and lists them when there are", () => {
    expect(renderFollowers(status())).toContain("No other relay processes");
    const html = renderFollowers(
      status({ followers: [{ instance: "5151", lastSeen: NOW - 3_000, calls: 7 }] })
    );
    expect(html).toContain("5151");
    expect(html).toContain("just now");
    expect(html).toContain(">7<");
  });
});
