import { describe, expect, test } from "bun:test";
import card from "./fixtures/card.json" with { type: "json" };
import { cssVarName, toReact } from "./react.js";
import type { SerializedNode } from "./tokens.js";

const output = toReact(card as unknown as SerializedNode);

describe("cssVarName", () => {
  test("turns a token path into a CSS custom property", () => {
    expect(cssVarName("color/brand/primary")).toBe("--color-brand-primary");
  });

  test("collapses spaces and casing", () => {
    expect(cssVarName("Heading/M Bold")).toBe("--heading-m-bold");
  });
});

describe("toReact", () => {
  test("emits auto-layout as flex with the real gap and padding", () => {
    expect(output).toContain("flex flex-col");
    expect(output).toContain("gap-[12px]");
    expect(output).toContain("p-[16px]");
  });

  test("uses the token, never the hex, for a bound fill", () => {
    expect(output).toContain("var(--color-surface)");
    expect(output).not.toContain("#101820");
  });

  test("falls back to the raw colour where nothing is bound", () => {
    expect(output).toContain("#FFFFFF");
  });

  test("names the Figma component instead of inventing one", () => {
    expect(output).toContain("{/* Figma component: Button/Primary — map with Code Connect */}");
  });

  test("renders text content", () => {
    expect(output).toContain("Monthly report");
  });

  test("is stable across runs", () => {
    expect(toReact(card as unknown as SerializedNode)).toBe(output);
  });
});

describe("toReact text escaping", () => {
  // Reference code goes into a JSX or HTML file: braces and angle brackets in
  // design copy would otherwise produce code that does not parse.
  test("escapes JSX-significant characters in text content", () => {
    const out = toReact({
      id: "2:1",
      name: "Copy",
      type: "TEXT",
      characters: "Total < 100 & {user}",
    } as unknown as SerializedNode);
    expect(out).toContain("Total &lt; 100 &amp; &#123;user&#125;");
    expect(out).not.toContain("{user}");
  });
});

describe("toReact instances", () => {
  // The placeholder must not invent a codebase component, but hiding the
  // instance's content would hide the button label the agent has to render.
  test("renders an instance's children inside the placeholder", () => {
    const out = toReact({
      id: "4:1",
      name: "Confirm",
      type: "INSTANCE",
      design: { mainComponent: { id: "9:1", key: "btn", name: "Button/Primary" } },
      children: [{ id: "4:2", name: "Label", type: "TEXT", characters: "Save changes" }],
    } as unknown as SerializedNode);
    expect(out).toContain("Figma component: Button/Primary");
    expect(out).toContain("Save changes");
  });
});
