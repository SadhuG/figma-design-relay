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

describe("composeDesignContext honesty", () => {
  // A reference whose name never resolved is not a token the agent can map;
  // listing it beside real tokens makes "a raw value means nothing was bound"
  // false, because the code did fall back to the raw value for it.
  test("lists unresolved references apart from tokens", () => {
    const [first] = composeDesignContext({
      tree: {
        ...tree,
        design: {
          boundVariables: [
            { property: "fills[0]", variableId: "VariableID:abc/1:2" },
            { property: "strokes[0]", variableId: "V:2", variableName: "color/border" },
          ],
        },
      } as unknown as SerializedNode,
      format: "react",
      assets: [],
    });
    const text = (first as { text: string }).text;
    expect(text).toContain("## Unresolved references");
    expect(text.indexOf("VariableID:abc/1:2")).toBeGreaterThan(text.indexOf("## Unresolved"));
    const tokenSection = text.slice(
      text.indexOf("## Design tokens"),
      text.indexOf("## Unresolved")
    );
    expect(tokenSection).toContain("color/border");
    expect(tokenSection).not.toContain("VariableID:abc/1:2");
  });

  // Containers cut off at `depth` cannot be classified as icons. When assets
  // were asked for, silence would read as "there were no icons".
  test("says when collapsed containers may hide assets", () => {
    const [first] = composeDesignContext({
      tree: {
        ...tree,
        children: [{ id: "1:9", name: "Button", type: "INSTANCE", childCount: 2 }],
      } as unknown as SerializedNode,
      format: "react",
      assets: [],
      assetDir: "assets",
    });
    expect((first as { text: string }).text).toMatch(/1 container.*collapsed at depth/);
  });
});

describe("composeDesignContext assets in code", () => {
  test("references an exported node by file in the reference code", () => {
    const [first] = composeDesignContext({
      tree: {
        ...tree,
        children: [
          {
            id: "1:2",
            name: "icon/search",
            type: "VECTOR",
            styles: { fills: [{ type: "SOLID", color: "#123456" }] },
          },
        ],
      } as unknown as SerializedNode,
      format: "react",
      assets: [
        {
          nodeId: "1:2",
          nodeName: "icon/search",
          file: "assets/icon-search-1-2.svg",
          format: "SVG",
          bytes: 1,
        },
      ],
    });
    const text = (first as { text: string }).text;
    expect(text).toContain('<img src="assets/icon-search-1-2.svg"');
    expect(text).not.toContain("#123456");
  });

  test("puts Code Connect mappings ahead of the reference code", () => {
    const [first] = composeDesignContext({
      tree,
      format: "react",
      assets: [],
      mappings: {
        "1:1": {
          component: "Card",
          fileKey: "AbC",
          nodeId: "7:7",
          source: "src/ui/Card.figma.tsx",
          importPath: "src/ui/Card",
          props: [],
        },
      },
    });
    const text = (first as { text: string }).text;
    expect(text).toContain("## Code Connect mappings");
    expect(text).toContain("`1:1` Card → `Card` from `src/ui/Card`");
    expect(text.indexOf("Code Connect mappings")).toBeLessThan(text.indexOf("Reference code"));
  });

  test("omits the Code Connect section when nothing is mapped", () => {
    const [first] = composeDesignContext({ tree, format: "react", assets: [], mappings: {} });
    expect((first as { text: string }).text).not.toContain("Code Connect");
  });
});

describe("composeDesignContext library instances", () => {
  const screen = {
    id: "2:1",
    name: "Screen",
    type: "FRAME",
    children: [
      {
        id: "2:2",
        name: "Save",
        type: "INSTANCE",
        design: { mainComponent: { id: "9:1", name: "Button", remote: true } },
      },
    ],
  } as unknown as SerializedNode;

  // A mapping to a library component cannot be matched from a consuming file,
  // and silence would read as "no component exists — generate one".
  test("warns that library instances cannot be matched to mappings", () => {
    const [first] = composeDesignContext({ tree: screen, format: "react", assets: [] });
    expect((first as { text: string }).text).toMatch(/1 instance comes from a library/);
  });

  test("does not warn about a library instance that is mapped", () => {
    const [first] = composeDesignContext({
      tree: screen,
      format: "react",
      assets: [],
      mappings: {
        "2:2": {
          component: "Button",
          fileKey: "L",
          nodeId: "1:1",
          source: "b.figma.tsx",
          props: [],
        },
      },
    });
    expect((first as { text: string }).text).not.toMatch(/from a library/);
  });
});
