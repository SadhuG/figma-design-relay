import { describe, expect, test } from "bun:test";
import { serializeFigJamNode } from "./figjam-serializer";

describe("serializeFigJamNode", () => {
  test("returns undefined for a design node", () => {
    expect(serializeFigJamNode({ type: "RECTANGLE" })).toBeUndefined();
  });

  test("keeps a sticky's text and author colour", () => {
    expect(
      serializeFigJamNode({
        type: "STICKY",
        text: { characters: "Ship it" },
        authorVisible: true,
        authorName: "Sam",
      })
    ).toEqual({ text: "Ship it", authorName: "Sam" });
  });

  test("keeps a connector's endpoints so topology survives", () => {
    expect(
      serializeFigJamNode({
        type: "CONNECTOR",
        connectorStart: { endpointNodeId: "1:1", magnet: "AUTO" },
        connectorEnd: { endpointNodeId: "1:2", magnet: "AUTO" },
        connectorLineType: "ELBOWED",
        text: { characters: "then" },
      })
    ).toEqual({
      text: "then",
      connector: { from: "1:1", to: "1:2", lineType: "ELBOWED" },
    });
  });

  test("keeps a free-floating connector endpoint as a position", () => {
    const out = serializeFigJamNode({
      type: "CONNECTOR",
      connectorStart: { position: { x: 10, y: 20 } },
      connectorEnd: { endpointNodeId: "1:2" },
    });
    expect(out?.connector).toEqual({ from: null, to: "1:2", lineType: undefined });
  });

  test("keeps a shape-with-text's shape and text", () => {
    expect(
      serializeFigJamNode({
        type: "SHAPE_WITH_TEXT",
        shapeType: "DIAMOND",
        text: { characters: "OK?" },
      })
    ).toEqual({ text: "OK?", shapeType: "DIAMOND" });
  });

  test("keeps a code block's language", () => {
    expect(
      serializeFigJamNode({ type: "CODE_BLOCK", code: "const a = 1;", codeLanguage: "TYPESCRIPT" })
    ).toEqual({ text: "const a = 1;", codeLanguage: "TYPESCRIPT" });
  });

  test("keeps a table's cell text", () => {
    const out = serializeFigJamNode({
      type: "TABLE",
      numRows: 1,
      numColumns: 2,
      cellAt: (row: number, column: number) => ({ text: { characters: `r${row}c${column}` } }),
    });
    expect(out?.table).toEqual([["r0c0", "r0c1"]]);
  });
});
