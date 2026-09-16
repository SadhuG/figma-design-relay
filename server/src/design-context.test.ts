import { describe, expect, test } from "bun:test";
import { composeDesignContext } from "./tools.js";
import type { SerializedNode } from "./codegen/tokens.js";

const tree = {
  id: "1:1",
  name: "Card",
  type: "FRAME",
  styles: { fills: [{ type: "SOLID", color: "#101820" }] },
  design: {
    boundVariables: [{ property: "fills[0]", variableId: "V:1", variableName: "color/surface" }],
  },
} as unknown as SerializedNode;

describe("composeDesignContext", () => {
  test("puts the code and the tokens in a text block", () => {
    const [first] = composeDesignContext({ tree, format: "react", assets: [] });
    expect(first.type).toBe("text");
    expect((first as { text: string }).text).toContain("var(--color-surface)");
    expect((first as { text: string }).text).toContain("color/surface");
  });

  test("adds an image block when a screenshot is supplied", () => {
    const blocks = composeDesignContext({
      tree,
      format: "react",
      assets: [],
      screenshot: { base64: "AAAA", format: "PNG" },
    });
    expect(blocks.some((block) => block.type === "image")).toBe(true);
  });

  test("tells the agent to use exported files rather than draw icons", () => {
    const [first] = composeDesignContext({
      tree,
      format: "react",
      assets: [
        {
          nodeId: "1:2",
          nodeName: "icon/search",
          file: "assets/icon-search.svg",
          format: "SVG",
          bytes: 120,
        },
      ],
    });
    const text = (first as { text: string }).text;
    expect(text).toContain("assets/icon-search.svg");
    expect(text).toMatch(/do not hand-write/i);
  });

  test("flags truncation instead of returning an oversized block", () => {
    const wide = {
      ...tree,
      children: Array.from({ length: 5000 }, (_, i) => ({ ...tree, id: `9:${i}` })),
    };
    const [first] = composeDesignContext({
      tree: wide as SerializedNode,
      format: "react",
      assets: [],
    });
    expect((first as { text: string }).text).toContain("[truncated");
  });
});

describe("composeDesignContext notes", () => {
  // Silence here is a defect: an agent that asked for "the selection" and got
  // one of three nodes with no mention would build a third of the design.
  test("says when only the first of several selected nodes is described", () => {
    const [first] = composeDesignContext({
      tree,
      format: "react",
      assets: [],
      notes: ["3 nodes are selected; only Card (1:1) is described. Pass nodeId for the others."],
    });
    expect((first as { text: string }).text).toMatch(/^3 nodes are selected/);
  });

  test("says when the screenshot could not be taken", () => {
    const blocks = composeDesignContext({
      tree,
      format: "react",
      assets: [],
      notes: ["Screenshot unavailable: export failed."],
    });
    expect(blocks.some((block) => block.type === "image")).toBe(false);
    expect((blocks[0] as { text: string }).text).toContain("Screenshot unavailable");
  });
});
