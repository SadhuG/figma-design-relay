import { describe, expect, test } from "bun:test";
import { findExportableNodes } from "./assets.js";
import type { SerializedNode } from "./codegen/tokens.js";

const tree = {
  id: "1:1",
  name: "Screen",
  type: "FRAME",
  children: [
    { id: "1:2", name: "icon/search", type: "VECTOR" },
    {
      id: "1:3",
      name: "Hero",
      type: "RECTANGLE",
      styles: { fills: [{ type: "IMAGE", imageHash: "abc" }] },
    },
    { id: "1:4", name: "Title", type: "TEXT" },
    {
      id: "1:5",
      name: "Logo",
      type: "GROUP",
      children: [{ id: "1:6", name: "path", type: "VECTOR" }],
    },
  ],
} as unknown as SerializedNode;

describe("findExportableNodes", () => {
  test("finds vectors and image-filled nodes", () => {
    expect(findExportableNodes(tree)).toContain("1:2");
    expect(findExportableNodes(tree)).toContain("1:3");
  });

  test("skips text", () => {
    expect(findExportableNodes(tree)).not.toContain("1:4");
  });

  test("exports a vector group whole rather than its paths", () => {
    const ids = findExportableNodes(tree);
    expect(ids).toContain("1:5");
    expect(ids).not.toContain("1:6");
  });

  test("returns an empty list for a tree with nothing to export", () => {
    expect(
      findExportableNodes({ id: "2:1", name: "Plain", type: "FRAME" } as SerializedNode)
    ).toEqual([]);
  });
});
