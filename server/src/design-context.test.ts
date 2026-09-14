import { describe, expect, test } from "bun:test";
import { composeDesignContext } from "./tools.js";
import type { SerializedNode } from "./codegen/tokens.js";

const tree = {
  id: "1:1",
  name: "Card",
  type: "FRAME",
  styles: { fills: [{ type: "SOLID", hex: "#101820" }] },
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
