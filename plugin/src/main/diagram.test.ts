import { describe, expect, test } from "bun:test";
import {
  capFor,
  connectorMagnets,
  fontLoader,
  labelFont,
  placementOrigin,
  readDiagramPayload,
  removeOnFailure,
  shapeFor,
  strokeFor,
} from "./diagram";

const node = { id: "A", label: "Start", shape: "rect", x: 0, y: 0, width: 160, height: 80 };
const payload = {
  kind: "flowchart",
  nodes: [node, { ...node, id: "B", y: 180 }],
  edges: [{ from: "A", to: "B", style: "solid" }],
  segments: [],
  width: 160,
  height: 260,
};

describe("readDiagramPayload", () => {
  test("accepts a laid-out diagram", () => {
    expect(readDiagramPayload(payload).nodes).toHaveLength(2);
  });

  test("refuses anything that is not a laid-out diagram, pointing at generate_diagram", () => {
    expect(() => readDiagramPayload(undefined)).toThrow(/generate_diagram/);
    expect(() => readDiagramPayload({ nodes: "nope" })).toThrow(/generate_diagram/);
  });

  test("refuses a node without a position", () => {
    expect(() =>
      readDiagramPayload({ ...payload, nodes: [{ id: "A", label: "x", shape: "rect" }] })
    ).toThrow(/node 0/);
  });

  test("refuses an edge that names a node the diagram does not have", () => {
    expect(() =>
      readDiagramPayload({ ...payload, edges: [{ from: "A", to: "Z", style: "solid" }] })
    ).toThrow(/Z/);
  });

  // Checked before anything is created, so a bad shape never leaves half a
  // diagram on the board.
  test("refuses a shape it cannot draw", () => {
    expect(() =>
      readDiagramPayload({ ...payload, nodes: [{ ...node, shape: "blob" }], edges: [] })
    ).toThrow(/blob/);
  });

  // The lookup tables are objects; a built-in property name must not pass the check
  // and then fail half-way through drawing.
  test("refuses a shape or cap named after a built-in object property", () => {
    expect(() =>
      readDiagramPayload({ ...payload, nodes: [{ ...node, shape: "toString" }], edges: [] })
    ).toThrow(/toString/);
    expect(() =>
      readDiagramPayload({
        ...payload,
        edges: [{ from: "A", to: "B", style: "solid", endCap: "constructor" }],
      })
    ).toThrow(/constructor/);
  });

  test("accepts sequence segments", () => {
    const sequence = {
      ...payload,
      kind: "sequence",
      edges: [],
      segments: [
        { role: "lifeline", start: { x: 80, y: 80 }, end: { x: 80, y: 300 }, style: "dashed" },
      ],
    };
    expect(readDiagramPayload(sequence).segments).toHaveLength(1);
  });
});

describe("shapeFor", () => {
  test("maps every parser shape to a FigJam shape", () => {
    expect(shapeFor("rect")).toBe("SQUARE");
    expect(shapeFor("diamond")).toBe("DIAMOND");
    expect(shapeFor("cylinder")).toBe("ENG_DATABASE");
    expect(shapeFor("subroutine")).toBe("PREDEFINED_PROCESS");
    expect(shapeFor("parallelogram-alt")).toBe("PARALLELOGRAM_LEFT");
    expect(shapeFor("start")).toBe("ELLIPSE");
  });
});

describe("capFor", () => {
  test("defaults the end of a link to an arrow and the start to nothing", () => {
    expect(capFor(undefined, "end")).toBe("ARROW_EQUILATERAL");
    expect(capFor(undefined, "start")).toBe("NONE");
  });

  test("draws ER cardinality with FigJam's crow's-foot caps", () => {
    expect(capFor("zero-or-more", "end")).toBe("ERD_ZERO_OR_MORE");
    expect(capFor("exactly-one", "start")).toBe("ERD_EXACTLY_ONE");
  });

  test("keeps an open arrow distinct from a filled one", () => {
    expect(capFor("open-arrow", "end")).toBe("ARROW_LINES");
  });
});

describe("strokeFor", () => {
  test("dashes a dashed link and thickens a thick one", () => {
    expect(strokeFor("dashed").dashPattern.length).toBeGreaterThan(0);
    expect(strokeFor("solid").dashPattern).toEqual([]);
    expect(strokeFor("thick").strokeWeight).toBeGreaterThan(strokeFor("solid").strokeWeight);
  });
});

describe("connectorMagnets", () => {
  test("lets FigJam choose the sides between two nodes", () => {
    expect(connectorMagnets("A", "B")).toEqual({ start: "AUTO", end: "AUTO" });
  });

  // AUTO on both ends of a self-loop collapses the connector to a point.
  test("gives a node connected to itself two distinct sides", () => {
    const { start, end } = connectorMagnets("A", "A");
    expect(start).not.toBe("AUTO");
    expect(end).not.toBe("AUTO");
    expect(start).not.toBe(end);
  });
});

describe("removeOnFailure", () => {
  const fakeNode = () => {
    const node = { removed: false, remove: () => (node.removed = true) };
    return node;
  };

  test("removes every node created before the failure, then rethrows", async () => {
    const created = [fakeNode(), fakeNode()];
    await expect(
      removeOnFailure(created, async () => {
        throw new Error("font failed");
      })
    ).rejects.toThrow("font failed");
    expect(created.every((node) => node.removed)).toBe(true);
  });

  test("leaves the nodes alone when the work succeeds", async () => {
    const created = [fakeNode()];
    expect(await removeOnFailure(created, async () => 42)).toBe(42);
    expect(created[0].removed).toBe(false);
  });
});

describe("fontLoader", () => {
  test("loads each font once however often it is asked for", async () => {
    const calls: string[] = [];
    const load = fontLoader(async (font) => {
      calls.push(`${font.family} ${font.style}`);
    });
    await load({ family: "Inter", style: "Medium" });
    await load({ family: "Inter", style: "Medium" });
    await load({ family: "Inter", style: "Bold" });
    expect(calls).toEqual(["Inter Medium", "Inter Bold"]);
  });

  // A failed load must be retryable, not cached as done.
  test("tries a font again after it failed to load", async () => {
    let attempts = 0;
    const load = fontLoader(async () => {
      attempts++;
      if (attempts === 1) throw new Error("offline");
    });
    await expect(load({ family: "Inter", style: "Medium" })).rejects.toThrow("offline");
    await load({ family: "Inter", style: "Medium" });
    expect(attempts).toBe(2);
  });
});

describe("labelFont", () => {
  // Seen live: a new connector reports { family: "", style: "" } until it has
  // text, and loading that font throws.
  test("falls back to FigJam's default font for an empty connector", () => {
    expect(labelFont({ family: "", style: "" })).toEqual({ family: "Inter", style: "Medium" });
  });

  test("keeps a font the node already has", () => {
    expect(labelFont({ family: "Roboto", style: "Bold" })).toEqual({
      family: "Roboto",
      style: "Bold",
    });
  });
});

describe("placementOrigin", () => {
  test("starts at the origin on an empty board", () => {
    expect(placementOrigin([])).toEqual({ x: 0, y: 0 });
  });

  test("goes to the right of existing content, top-aligned", () => {
    expect(
      placementOrigin([
        { x: 0, y: 50, width: 100, height: 100 },
        { x: 300, y: -20, width: 50, height: 10 },
      ])
    ).toEqual({ x: 550, y: -20 });
  });
});
