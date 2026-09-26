import { describe, expect, test } from "bun:test";
import card from "./fixtures/card.json" with { type: "json" };
import { generateCode } from "./index.js";
import type { SerializedNode } from "./tokens.js";

const tree = card as unknown as SerializedNode;

describe("generateCode", () => {
  test("react is the same output the react module produces", () => {
    expect(generateCode(tree, "react")).toContain("<div className=");
  });

  test("html emits class attributes rather than className", () => {
    const html = generateCode(tree, "html");
    expect(html).toContain("<div class=");
    expect(html).not.toContain("className");
  });

  test("html turns the component description and annotation hints into HTML comments", () => {
    const html = generateCode(tree, "html");
    expect(html).toContain("<!-- component description: Primary call to action. -->");
    expect(html).toContain("<!-- annotation: Pinned to the card's bottom edge [layoutAlign] -->");
  });

  test("css emits one rule per named node and uses the token", () => {
    const css = generateCode(tree, "css");
    expect(css).toContain(".card {");
    expect(css).toContain("background: var(--color-surface);");
  });

  test("json round-trips the tree", () => {
    expect(JSON.parse(generateCode(tree, "json")).id).toBe("1:1");
  });

  test("rejects an unknown format by name", () => {
    expect(() => generateCode(tree, "swift" as never)).toThrow(/swift/);
  });
});
