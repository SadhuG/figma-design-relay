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

  test("falls back to the raw hex where nothing is bound", () => {
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
