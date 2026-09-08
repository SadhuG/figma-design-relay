import { describe, expect, test } from "bun:test";
import { collectTokens } from "./tokens.js";

const tree = {
  id: "1:1",
  name: "Card",
  type: "FRAME",
  design: {
    boundVariables: [
      {
        property: "fills[0]",
        variableId: "V:1",
        variableName: "color/surface",
        collectionName: "Brand",
      },
    ],
  },
  children: [
    {
      id: "1:2",
      name: "Title",
      type: "TEXT",
      design: {
        boundVariables: [
          {
            property: "fills[0]",
            variableId: "V:2",
            variableName: "color/text",
            collectionName: "Brand",
          },
        ],
        styles: { text: { id: "S:1", name: "Heading/M" } },
      },
    },
    {
      id: "1:3",
      name: "Body",
      type: "TEXT",
      design: {
        boundVariables: [
          {
            property: "fills[0]",
            variableId: "V:2",
            variableName: "color/text",
            collectionName: "Brand",
          },
        ],
      },
    },
  ],
};

describe("collectTokens", () => {
  test("collects variables and styles from the whole subtree", () => {
    const names = collectTokens(tree).map((token) => token.name);
    expect(names).toEqual(["color/surface", "color/text", "Heading/M"]);
  });

  test("deduplicates a token used twice and records both users", () => {
    const text = collectTokens(tree).find((token) => token.name === "color/text");
    expect(text?.usedBy).toEqual(["1:2", "1:3"]);
  });

  test("distinguishes variables from styles", () => {
    const kinds = collectTokens(tree).map((token) => token.kind);
    expect(kinds).toEqual(["variable", "variable", "style"]);
  });

  test("returns an empty list for a tree with no design system", () => {
    expect(collectTokens({ id: "2:1", name: "Plain", type: "RECTANGLE" })).toEqual([]);
  });

  test("keeps a token whose name never resolved, under its id", () => {
    const out = collectTokens({
      id: "3:1",
      name: "Odd",
      type: "FRAME",
      design: { boundVariables: [{ property: "opacity", variableId: "V:9" }] },
    });
    expect(out).toEqual([
      { name: "V:9", kind: "variable", property: "opacity", usedBy: ["3:1"], resolved: false },
    ]);
  });
});
