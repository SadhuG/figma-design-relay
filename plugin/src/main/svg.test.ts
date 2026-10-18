import { describe, expect, test } from "bun:test";
import { createSvg } from "./svg";

const SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'/>";

/** A fake createNodeFromSvg frame; `parent` changes when it is appended. */
const fakeFrame = (overrides: Record<string, unknown> = {}) => {
  const frame: any = {
    id: "9:1",
    name: "Svg",
    type: "FRAME",
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    parent: { id: "0:1" },
    children: [{ id: "9:2" }, { id: "9:3" }],
    removed: false,
    removeCalls: 0,
    resize(width: number, height: number) {
      frame.width = width;
      frame.height = height;
    },
    remove() {
      frame.removeCalls += 1;
      frame.removed = true;
    },
    ...overrides,
  };
  return frame;
};

const apiFor = (frame: any, parent?: any) => {
  let creates = 0;
  return {
    get creates() {
      return creates;
    },
    createNodeFromSvg(svg: string) {
      creates += 1;
      expect(svg).toBe(SVG);
      return frame;
    },
    async getParentNodeById(id: string) {
      if (!parent || id !== parent.id) throw new Error(`Parent does not support children: ${id}`);
      return parent;
    },
  };
};

const parentNode = () => {
  const parent: any = {
    id: "5:1",
    children: [] as any[],
    appendChild(node: any) {
      parent.children.push(node);
      node.parent = parent;
    },
  };
  return parent;
};

describe("createSvg", () => {
  test("an invalid parent creates nothing", async () => {
    const frame = fakeFrame();
    const api = apiFor(frame);
    await expect(createSvg(SVG, { parentId: "7:7" }, api as any)).rejects.toThrow(/7:7/);
    expect(api.creates).toBe(0);
  });

  test("x/y are set after appending, so they are relative to the final parent", async () => {
    const frame = fakeFrame();
    const order: string[] = [];
    const parent = parentNode();
    const append = parent.appendChild;
    parent.appendChild = (node: any) => {
      order.push("append");
      append(node);
    };
    Object.defineProperty(frame, "x", {
      get: () => frame._x ?? 0,
      set: (v) => {
        order.push("x");
        frame._x = v;
      },
    });
    const result = await createSvg(SVG, { parentId: "5:1", x: 12, y: 3 }, apiFor(frame, parent));
    expect(order).toEqual(["append", "x"]);
    expect(result).toMatchObject({ parentId: "5:1", x: 12, y: 3 });
  });

  test("width alone keeps the height, and height alone keeps the width", async () => {
    const wide = await createSvg(SVG, { width: 100 }, apiFor(fakeFrame()) as any);
    expect([wide.width, wide.height]).toEqual([100, 20]);
    const tall = await createSvg(SVG, { height: 50 }, apiFor(fakeFrame()) as any);
    expect([tall.width, tall.height]).toEqual([40, 50]);
  });

  test("the result names the node, its type and its child count", async () => {
    const result = await createSvg(SVG, { name: "Logo" }, apiFor(fakeFrame()) as any);
    expect(result).toEqual({
      nodeId: "9:1",
      nodeName: "Logo",
      nodeType: "FRAME",
      parentId: "0:1",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      childCount: 2,
    });
  });

  for (const failing of ["resize", "append", "position"] as const) {
    test(`a ${failing} failure removes the new SVG exactly once`, async () => {
      const frame = fakeFrame();
      const parent = parentNode();
      if (failing === "resize") {
        frame.resize = () => {
          throw new Error("resize failed");
        };
      }
      if (failing === "append") {
        parent.appendChild = () => {
          throw new Error("append failed");
        };
      }
      if (failing === "position") {
        Object.defineProperty(frame, "y", {
          get: () => 0,
          set: () => {
            throw new Error("position failed");
          },
        });
      }
      await expect(
        createSvg(SVG, { parentId: "5:1", width: 10, y: 1 }, apiFor(frame, parent) as any)
      ).rejects.toThrow(`${failing} failed`);
      expect(frame.removeCalls).toBe(1);
    });
  }

  test("blank markup is refused before anything is created", async () => {
    const api = apiFor(fakeFrame());
    await expect(createSvg("   ", {}, api as any)).rejects.toThrow(/svgText/);
    expect(api.creates).toBe(0);
  });
});
