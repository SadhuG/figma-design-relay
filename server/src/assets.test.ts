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

  // Icons in a design system are instances of an icon component, so the same
  // rule has to hold for an instance (or the component itself) whose children
  // are all vectors — otherwise a logo comes out as a pile of `Vector` files.
  test("exports an icon instance whole rather than its paths", () => {
    const ids = findExportableNodes({
      id: "3:1",
      name: "Button",
      type: "INSTANCE",
      children: [
        { id: "3:2", name: "Label", type: "TEXT" },
        {
          id: "3:3",
          name: "google-logo-color",
          type: "INSTANCE",
          children: [
            { id: "3:4", name: "Vector", type: "VECTOR" },
            { id: "3:5", name: "Vector", type: "VECTOR" },
          ],
        },
      ],
    } as unknown as SerializedNode);
    expect(ids).toEqual(["3:3"]);
  });

  test("returns an empty list for a tree with nothing to export", () => {
    expect(
      findExportableNodes({ id: "2:1", name: "Plain", type: "FRAME" } as SerializedNode)
    ).toEqual([]);
  });
});
