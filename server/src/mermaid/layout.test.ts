import { describe, expect, test } from "bun:test";
import { layoutDiagram } from "./layout.js";
import { parseMermaid } from "./parse.js";

const flow = layoutDiagram(parseMermaid("flowchart TD\n A[Start] --> B[Middle]\n B --> C[End]"));

describe("layoutDiagram", () => {
  test("positions every node", () => {
    expect(flow.nodes).toHaveLength(3);
    expect(flow.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
      true
    );
  });

  test("stacks a top-down chain vertically without overlap", () => {
    const ys = flow.nodes.map((node) => node.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(flow.nodes[0].y + flow.nodes[0].height).toBeLessThan(flow.nodes[1].y);
  });

  test("places a left-right diagram horizontally instead", () => {
    const lr = layoutDiagram(parseMermaid("flowchart LR\n A --> B"));
    expect(lr.nodes[0].x).toBeLessThan(lr.nodes[1].x);
    expect(lr.nodes[0].y).toBe(lr.nodes[1].y);
  });

  test("reverses a bottom-up diagram", () => {
    const bt = layoutDiagram(parseMermaid("flowchart BT\n A --> B"));
    expect(bt.nodes[0].y).toBeGreaterThan(bt.nodes[1].y);
  });

  test("puts siblings on the same rank side by side", () => {
    const fan = layoutDiagram(parseMermaid("flowchart TD\n A --> B\n A --> C"));
    const [, b, c] = fan.nodes;
    expect(b.y).toBe(c.y);
    expect(b.x).not.toBe(c.x);
    expect(Math.abs(b.x - c.x)).toBeGreaterThanOrEqual(b.width);
  });

  test("reports a bounding box that contains every node", () => {
    const right = Math.max(...flow.nodes.map((node) => node.x + node.width));
    expect(flow.width).toBeGreaterThanOrEqual(right);
  });

  test("keeps every edge, including one that closes a cycle", () => {
    const cyclic = layoutDiagram(parseMermaid("flowchart TD\n A --> B\n B --> A"));
    expect(cyclic.edges).toHaveLength(2);
    expect(cyclic.nodes[0].y).toBeLessThan(cyclic.nodes[1].y);
  });

  test("ranks a dense graph without blowing up", () => {
    const lines = [];
    for (let i = 0; i < 40; i++) {
      for (let j = i + 1; j < Math.min(40, i + 4); j++) lines.push(`N${i} --> N${j}`);
    }
    const started = performance.now();
    const dense = layoutDiagram(parseMermaid(`flowchart TD\n${lines.join("\n")}`));
    expect(performance.now() - started).toBeLessThan(500);
    expect(dense.nodes[39].y).toBeGreaterThan(dense.nodes[0].y);
  });

  test("grows a node to fit a long label", () => {
    const sized = layoutDiagram(
      parseMermaid("flowchart TD\n A[Short] --> B[A much longer label than the other one]")
    );
    expect(sized.nodes[1].width).toBeGreaterThan(sized.nodes[0].width);
  });

  test("grows a node to fit several lines", () => {
    const er = layoutDiagram(parseMermaid("erDiagram\n A {\n string a\n string b\n string c\n }"));
    const plain = layoutDiagram(parseMermaid("erDiagram\n B"));
    expect(er.nodes[0].height).toBeGreaterThan(plain.nodes[0].height);
  });
});

describe("sequence layout", () => {
  const seq = layoutDiagram(
    parseMermaid("sequenceDiagram\n A->>B: hi\n B-->>C: bye\n C->>A: back")
  );

  test("lays sequence participants in a row", () => {
    expect(new Set(seq.nodes.map((node) => node.y)).size).toBe(1);
    expect(seq.nodes[0].x).toBeLessThan(seq.nodes[1].x);
  });

  test("draws messages as free segments, not node-to-node edges", () => {
    expect(seq.edges).toHaveLength(0);
    const messages = seq.segments.filter((segment) => segment.role === "message");
    expect(messages.map((segment) => segment.label)).toEqual(["hi", "bye", "back"]);
  });

  test("keeps message order top to bottom", () => {
    const ys = seq.segments
      .filter((segment) => segment.role === "message")
      .map((segment) => segment.start.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  test("runs each message between its participants' lifelines", () => {
    const center = (index: number) => seq.nodes[index].x + seq.nodes[index].width / 2;
    const first = seq.segments.find((segment) => segment.label === "hi");
    expect(first?.start.x).toBe(center(0));
    expect(first?.end.x).toBe(center(1));
    expect(seq.segments.find((segment) => segment.label === "bye")?.style).toBe("dashed");
  });

  test("gives every participant a dashed lifeline below every message", () => {
    const lifelines = seq.segments.filter((segment) => segment.role === "lifeline");
    expect(lifelines).toHaveLength(3);
    const lastMessage = Math.max(
      ...seq.segments.filter((s) => s.role === "message").map((s) => s.start.y)
    );
    for (const line of lifelines) {
      expect(line.style).toBe("dashed");
      expect(line.endCap).toBe("none");
      expect(line.end.y).toBeGreaterThan(lastMessage);
    }
  });

  test("draws a self-message as a loop that returns to its own lifeline", () => {
    const self = layoutDiagram(parseMermaid("sequenceDiagram\n A->>A: check"));
    const loop = self.segments.filter((segment) => segment.role === "message");
    expect(loop).toHaveLength(3);
    expect(loop[0].start).toEqual({ x: loop[2].end.x, y: loop[0].start.y });
    expect(loop[2].end.y).toBeGreaterThan(loop[0].start.y);
    expect(loop.filter((segment) => segment.endCap !== "none")).toHaveLength(1);
  });

  test("reports a bounding box that contains every segment", () => {
    const bottom = Math.max(...seq.segments.map((segment) => segment.end.y));
    expect(seq.height).toBeGreaterThanOrEqual(bottom);
  });
});
