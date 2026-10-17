import { describe, expect, test } from "bun:test";
import { executeLayoutAction } from "./layout-actions";

type Fake = Record<string, any>;

const frame = (id: string, overrides: Fake = {}): Fake => ({
  id,
  name: id,
  type: "FRAME",
  layoutMode: "NONE",
  children: [] as Fake[],
  ...overrides,
});

/** A free-positioned child appended to `parent`. */
const child = (
  parent: Fake,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra = {}
) => {
  const node: Fake = {
    id,
    name: id,
    type: "RECTANGLE",
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    parent,
    removed: false,
    writes: 0,
    remove() {
      node.removed = true;
      parent.children = parent.children.filter((c: Fake) => c !== node);
    },
    ...extra,
  };
  parent.children.push(node);
  return node;
};

const apiFor = (...nodes: Fake[]) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    async getSceneNodeById(id: string) {
      const node = byId.get(id);
      if (!node) throw new Error(`Node not found: ${id}`);
      return node as unknown as SceneNode;
    },
  };
};

const xs = (...nodes: Fake[]) => nodes.map((n) => n.x);

describe("distribute", () => {
  test("keeps the ends exactly and spaces the middle with equal gaps", async () => {
    const p = frame("p");
    const a = child(p, "a", 0, 0, 10, 10);
    const b = child(p, "b", 20, 0, 20, 10);
    const c = child(p, "c", 100, 0, 30, 10);
    const result = await executeLayoutAction(
      "distribute_horizontally",
      ["c", "a", "b"],
      {},
      apiFor(a, b, c)
    );
    expect(xs(a, b, c)).toEqual([0, 45, 100]);
    expect(result).toEqual({
      axis: "horizontal",
      gap: 35,
      movedCount: 1,
      results: [{ nodeId: "b", x: 45 }],
    });
  });

  test("works vertically, with fractional ends and zero sizes", async () => {
    const p = frame("p");
    const a = child(p, "a", 0, 0.25, 10, 0);
    const b = child(p, "b", 0, 3, 10, 0);
    const c = child(p, "c", 0, 10.75, 10, 0);
    await executeLayoutAction("distribute_vertically", ["a", "b", "c"], {}, apiFor(a, b, c));
    expect([a.y, b.y, c.y]).toEqual([0.25, 5.5, 10.75]);
  });

  test("an overlapping set gets an equal negative gap", async () => {
    const p = frame("p");
    const a = child(p, "a", 0, 0, 50, 10);
    const b = child(p, "b", 10, 0, 50, 10);
    const c = child(p, "c", 40, 0, 50, 10);
    const result = await executeLayoutAction(
      "distribute_horizontally",
      ["a", "b", "c"],
      {},
      apiFor(a, b, c)
    );
    expect(result.gap).toBe(-30);
    expect(xs(a, b, c)).toEqual([0, 20, 40]);
  });

  test("refuses fewer than three, repeats, mixed parents, rotation and auto-layout", async () => {
    const p = frame("p");
    const q = frame("q");
    const a = child(p, "a", 0, 0, 10, 10);
    const b = child(p, "b", 20, 0, 10, 10);
    const c = child(q, "c", 40, 0, 10, 10);
    const d = child(p, "d", 60, 0, 10, 10, { rotation: 15 });
    const api = apiFor(a, b, c, d);
    const run = (ids: string[]) => executeLayoutAction("distribute_horizontally", ids, {}, api);
    await expect(run(["a", "b"])).rejects.toThrow(/3/);
    await expect(run(["a", "b", "a"])).rejects.toThrow(/twice/);
    await expect(run(["a", "b", "c"])).rejects.toThrow(/parent/);
    await expect(run(["a", "b", "d"])).rejects.toThrow(/rotated/);
    const auto = frame("auto", { layoutMode: "HORIZONTAL" });
    const e = child(auto, "e", 0, 0, 1, 1);
    const f = child(auto, "f", 2, 0, 1, 1);
    const g = child(auto, "g", 4, 0, 1, 1);
    await expect(
      executeLayoutAction("distribute_horizontally", ["e", "f", "g"], {}, apiFor(e, f, g))
    ).rejects.toThrow(/auto-layout/);
    expect(xs(a, b, c, d)).toEqual([0, 20, 40, 60]);
  });

  test("a missing node fails before anything moves", async () => {
    const p = frame("p");
    const a = child(p, "a", 0, 0, 10, 10);
    const b = child(p, "b", 20, 0, 10, 10);
    await expect(
      executeLayoutAction("distribute_horizontally", ["a", "b", "zz"], {}, apiFor(a, b))
    ).rejects.toThrow(/zz/);
    expect(xs(a, b)).toEqual([0, 20]);
  });
});

describe("align_to_grid", () => {
  test("snaps local x and y to the nearest multiple", async () => {
    const p = frame("p");
    const a = child(p, "a", -14, 16, 1, 1);
    const result = await executeLayoutAction("align_to_grid", ["a"], { gridSize: 10 }, apiFor(a));
    expect([a.x, a.y]).toEqual([-10, 20]);
    expect(result).toEqual({
      gridSize: 10,
      updatedCount: 1,
      results: [{ nodeId: "a", x: -10, y: 20 }],
    });
  });

  test("refuses a non-positive grid and a node its parent positions", async () => {
    const p = frame("p");
    const a = child(p, "a", 3, 3, 1, 1);
    await expect(
      executeLayoutAction("align_to_grid", ["a"], { gridSize: 0 }, apiFor(a))
    ).rejects.toThrow(/gridSize/);
    const auto = frame("auto", { layoutMode: "VERTICAL" });
    const b = child(auto, "b", 3, 3, 1, 1);
    await expect(
      executeLayoutAction("align_to_grid", ["a", "b"], { gridSize: 10 }, apiFor(a, b))
    ).rejects.toThrow(/auto-layout/);
    expect([a.x, a.y]).toEqual([3, 3]);
  });

  test("an absolutely positioned child of an auto-layout frame can be snapped", async () => {
    const auto = frame("auto", { layoutMode: "VERTICAL" });
    const b = child(auto, "b", 3, 3, 1, 1, { layoutPositioning: "ABSOLUTE" });
    await executeLayoutAction("align_to_grid", ["b"], { gridSize: 4 }, apiFor(b));
    expect([b.x, b.y]).toEqual([4, 4]);
  });
});

describe("place_below and place_right_of", () => {
  const setup = () => {
    const p = frame("p");
    const ref = child(p, "ref", 10, 20, 100, 40);
    const target = child(p, "t", 0, 0, 20, 10);
    return { p, ref, target, api: apiFor(ref, target) };
  };

  test("place_below with a gap and centre alignment", async () => {
    const { target, api } = setup();
    const result = await executeLayoutAction(
      "place_below",
      ["t"],
      { relativeToId: "ref", gap: 5, align: "center" },
      api
    );
    expect([target.x, target.y]).toEqual([50, 65]);
    expect(result).toEqual({ nodeId: "t", nodeName: "t", x: 50, y: 65 });
  });

  test("place_right_of with a gap and centre alignment", async () => {
    const { target, api } = setup();
    await executeLayoutAction(
      "place_right_of",
      ["t"],
      { relativeToId: "ref", gap: 5, align: "center" },
      api
    );
    expect([target.x, target.y]).toEqual([115, 35]);
  });

  test("defaults to no gap and start alignment", async () => {
    const { target, api } = setup();
    await executeLayoutAction("place_below", ["t"], { relativeToId: "ref" }, api);
    expect([target.x, target.y]).toEqual([10, 60]);
  });

  test("refuses itself, another parent and a rotated reference", async () => {
    const { p, target, api } = setup();
    await expect(
      executeLayoutAction("place_below", ["t"], { relativeToId: "t" }, api)
    ).rejects.toThrow(/itself/);
    const other = child(frame("q"), "o", 0, 0, 5, 5);
    await expect(
      executeLayoutAction("place_below", ["t"], { relativeToId: "o" }, apiFor(target, other))
    ).rejects.toThrow(/parent/);
    const turned = child(p, "r2", 0, 0, 5, 5, { rotation: 90 });
    await expect(
      executeLayoutAction("place_right_of", ["t"], { relativeToId: "r2" }, apiFor(target, turned))
    ).rejects.toThrow(/rotated/);
    expect([target.x, target.y]).toEqual([0, 0]);
  });
});

describe("fit_to_content", () => {
  const section = (id = "s") => {
    const node: Fake = {
      id,
      name: id,
      type: "SECTION",
      x: 100,
      y: 200,
      width: 500,
      height: 500,
      children: [] as Fake[],
      resizeWithoutConstraints(w: number, h: number) {
        node.width = w;
        node.height = h;
      },
    };
    return node;
  };

  test("shifts children to the padding and wraps them, keeping the section's origin", async () => {
    const s = section();
    const a = child(s, "a", -10, 5, 20, 10);
    const b = child(s, "b", 30, 25, 10, 5);
    const result = await executeLayoutAction("fit_to_content", ["s"], { padding: 5 }, apiFor(s));
    expect([s.x, s.y, s.width, s.height]).toEqual([100, 200, 60, 35]);
    expect([a.x, a.y, b.x, b.y]).toEqual([5, 5, 45, 25]);
    expect(result).toEqual({
      nodeId: "s",
      nodeName: "s",
      x: 100,
      y: 200,
      width: 60,
      height: 35,
      childCount: 2,
    });
  });

  test("an empty section shrinks to twice the padding, never below 0.01", async () => {
    const s = section();
    await executeLayoutAction("fit_to_content", ["s"], {}, apiFor(s));
    expect([s.width, s.height]).toEqual([0.01, 0.01]);
    await executeLayoutAction("fit_to_content", ["s"], { padding: 8 }, apiFor(s));
    expect([s.width, s.height]).toEqual([16, 16]);
  });

  test("refuses a non-section and a rotated child without changing anything", async () => {
    const p = frame("p");
    await expect(executeLayoutAction("fit_to_content", ["p"], {}, apiFor(p))).rejects.toThrow(
      /SECTION/
    );
    const s = section();
    const a = child(s, "a", -10, 5, 20, 10, { rotation: 30 });
    await expect(executeLayoutAction("fit_to_content", ["s"], {}, apiFor(s))).rejects.toThrow(
      /rotated/
    );
    expect([a.x, s.width]).toEqual([-10, 500]);
  });

  test("refuses negative padding", async () => {
    const s = section();
    await expect(
      executeLayoutAction("fit_to_content", ["s"], { padding: -1 }, apiFor(s))
    ).rejects.toThrow(/padding/);
  });
});

describe("duplicate_with_offset", () => {
  const clonable = (parent: Fake, id: string, x: number, y: number, fail = false) => {
    const node = child(parent, id, x, y, 10, 10);
    let n = 0;
    node.clone = () => {
      if (fail) throw new Error(`cannot clone ${id}`);
      n += 1;
      return child(parent, `${id}-copy${n}`, node.x, node.y, 10, 10);
    };
    return node;
  };

  test("offsets each clone within its own parent and maps sources to copies", async () => {
    const p = frame("p");
    const q = frame("q");
    const a = clonable(p, "a", 0, 0);
    const b = clonable(q, "b", 10, 10);
    const result = await executeLayoutAction(
      "duplicate_with_offset",
      ["a", "b"],
      { offsetX: 5, offsetY: -3 },
      apiFor(a, b)
    );
    expect(result).toEqual({
      duplicatedCount: 2,
      duplicates: [
        { sourceNodeId: "a", nodeId: "a-copy1", nodeName: "a-copy1", parentId: "p", x: 5, y: -3 },
        { sourceNodeId: "b", nodeId: "b-copy1", nodeName: "b-copy1", parentId: "q", x: 15, y: 7 },
      ],
    });
    expect([a.x, a.y, b.x, b.y]).toEqual([0, 0, 10, 10]);
  });

  test("a later failure removes every clone already made", async () => {
    const p = frame("p");
    const a = clonable(p, "a", 0, 0);
    const b = clonable(p, "b", 10, 10, true);
    await expect(
      executeLayoutAction(
        "duplicate_with_offset",
        ["a", "b"],
        { offsetX: 1, offsetY: 1 },
        apiFor(a, b)
      )
    ).rejects.toThrow(/cannot clone b/);
    expect(p.children.map((c: Fake) => c.id)).toEqual(["a", "b"]);
  });

  test("refuses a repeated id and a node that cannot be cloned before cloning anything", async () => {
    const p = frame("p");
    const a = clonable(p, "a", 0, 0);
    const plain = child(p, "plain", 0, 0, 1, 1);
    const api = apiFor(a, plain);
    const run = (ids: string[]) =>
      executeLayoutAction("duplicate_with_offset", ids, { offsetX: 1, offsetY: 1 }, api);
    await expect(run(["a", "a"])).rejects.toThrow(/twice/);
    await expect(run(["a", "plain"])).rejects.toThrow(/duplicat/);
    expect(p.children.map((c: Fake) => c.id)).toEqual(["a", "plain"]);
  });
});
