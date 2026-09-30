import { describe, expect, test } from "bun:test";
import { getLayoutTree } from "./layout-tree";

const page = { id: "2:0", type: "PAGE", parent: null };
const scene = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "RECTANGLE",
  parent: page,
  visible: true,
  width: 30,
  height: 40,
  absoluteTransform: [
    [1, 0, 10],
    [0, 1, 20],
  ],
  absoluteBoundingBox: { x: 10, y: 20, width: 30, height: 40 },
  ...extra,
});
const capture = (root: unknown, maxNodes = 2000) =>
  getLayoutTree("3:0", maxNodes, {
    getNodeByIdAsync: async () => root as BaseNode | null,
    fileName: "Test document",
  });

describe("layout tree", () => {
  test("preserves absolute geometry, hidden nodes and the containing page", async () => {
    const root = scene("3:0", { children: [scene("3:1", { visible: false })] });
    const result = await capture(root);
    expect(result.pageId).toBe("2:0");
    expect(result.fileKey).toBeNull();
    expect(result.atomicWithScreenshot).toBe(false);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[1]).toMatchObject({ visible: false, absoluteRenderBounds: null });
    expect(result.capture.window).toEqual(root.absoluteBoundingBox);
    expect(result.truncated).toBe(false);
  });

  test("stops reading siblings once the node budget is exhausted", async () => {
    const unread = scene("3:2");
    Object.defineProperty(unread, "id", {
      get() {
        throw new Error("over budget");
      },
    });
    const result = await capture(scene("3:0", { children: [scene("3:1"), unread] }), 2);
    expect(result.nodes).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  test("an exactly full tree is not marked truncated", async () => {
    expect((await capture(scene("3:0"), 1)).truncated).toBe(false);
  });

  test("caps deeply nested walks", async () => {
    let root = scene("3:101");
    for (let i = 100; i >= 0; i--) root = scene(`3:${i}`, { children: [root] });
    const result = await capture(root);
    expect(result.nodes).toHaveLength(101);
    expect(result.truncated).toBe(true);
  });

  test("rejects missing nodes and non-scene roots with a next step", async () => {
    for (const root of [null, page, { type: "DOCUMENT" }]) {
      await expect(capture(root)).rejects.toThrow("Pass a scene node id");
    }
  });
});
