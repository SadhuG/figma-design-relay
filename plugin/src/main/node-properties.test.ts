import { describe, expect, test } from "bun:test";
import { applyNodeProperties, preflightNodeProperties } from "./node-properties";

const rect = (overrides: Record<string, unknown> = {}): any => {
  const node: any = {
    id: "1:1",
    name: "Rect",
    type: "RECTANGLE",
    x: 0,
    y: 0,
    width: 10,
    height: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    cornerRadius: 0,
    resize(width: number, height: number) {
      node.width = width;
      node.height = height;
    },
    ...overrides,
  };
  return node;
};

describe("preflightNodeProperties", () => {
  test("accepts every supported property on a rectangle", () => {
    expect(() =>
      preflightNodeProperties(rect(), {
        name: "n",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        rotation: 5,
        opacity: 0.5,
        visible: false,
        cornerRadius: 2,
      })
    ).not.toThrow();
  });

  test("refuses cornerRadius where FigJam exposes it read-only", () => {
    for (const type of ["SHAPE_WITH_TEXT", "CONNECTOR"]) {
      expect(() => preflightNodeProperties(rect({ type }), { cornerRadius: 4 })).toThrow(
        /cornerRadius/
      );
    }
  });

  test("refuses properties a node does not have", () => {
    const group: any = { id: "2:2", name: "G", type: "GROUP", x: 0, y: 0, visible: true };
    expect(() => preflightNodeProperties(group, { cornerRadius: 1 })).toThrow(/2:2/);
    expect(() => preflightNodeProperties(group, { rotation: 1 })).toThrow(/rotation/);
    expect(() => preflightNodeProperties(group, { opacity: 1 })).toThrow(/opacity/);
    expect(() => preflightNodeProperties(group, { width: 1 })).toThrow(/resiz/);
  });

  test("changes nothing", () => {
    const node = rect();
    preflightNodeProperties(node, { x: 99, cornerRadius: 3 });
    expect([node.x, node.cornerRadius]).toEqual([0, 0]);
  });
});

describe("applyNodeProperties", () => {
  test("applies the patch and reports what was set", () => {
    const node = rect();
    expect(applyNodeProperties(node, { name: "New", visible: false, x: 5, opacity: 0.4 })).toEqual({
      name: "New",
      visible: false,
      x: 5,
      y: 0,
      opacity: 0.4,
    });
    expect([node.name, node.visible, node.x, node.opacity]).toEqual(["New", false, 5, 0.4]);
  });

  test("a width alone keeps the height", () => {
    const node = rect();
    expect(applyNodeProperties(node, { width: 30 })).toEqual({ width: 30, height: 20 });
  });
});
