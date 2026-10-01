import { describe, expect, test } from "bun:test";
import { toHtml } from "./html.js";
import type { SerializedNode } from "./tokens.js";

describe("toHtml", () => {
  test("closes empty containers before the following sibling", () => {
    const html = toHtml({
      id: "1:1",
      name: "Row",
      type: "FRAME",
      children: [
        { id: "1:2", name: "Spacer", type: "FRAME" },
        { id: "1:3", name: "Label", type: "TEXT", characters: "Hello" },
      ],
    } as SerializedNode);
    expect(html).toBe("<div>\n  <div></div>\n  <span>Hello</span>\n</div>");
  });

  test("closes self-closing component references but preserves void images", () => {
    const html = toHtml(
      {
        id: "1:1",
        name: "Row",
        type: "FRAME",
        children: [
          { id: "1:2", name: "Button", type: "INSTANCE" },
          { id: "1:3", name: "Icon", type: "VECTOR" },
        ],
      } as SerializedNode,
      {
        mappings: { "1:2": { component: "Button", source: "Button.figma.tsx" } },
        assets: { "1:3": "assets/icon.svg" },
      }
    );
    expect(html).toContain('<Button data-figma-node="1:2"></Button>');
    expect(html).toContain('<img src="assets/icon.svg" alt="Icon" data-figma-node="1:3" />');
    expect(html).not.toContain("</img>");
  });
});
