import { describe, expect, test } from "bun:test";
import { capFor, placementOrigin, readDiagramPayload, shapeFor, strokeFor } from "./diagram";

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
