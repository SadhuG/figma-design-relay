import { describe, expect, test } from "bun:test";
import { imageBlock, textBlock } from "./content.js";

describe("textBlock", () => {
  test("wraps a string", () => {
    expect(textBlock("hi")).toEqual({ type: "text", text: "hi" });
  });
});

describe("imageBlock", () => {
  test("maps PNG to image/png", () => {
    expect(imageBlock("AAAA", "PNG")).toEqual({
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    });
  });

  test("maps JPG to image/jpeg", () => {
    expect(imageBlock("AAAA", "JPG")?.mimeType).toBe("image/jpeg");
  });

  test("returns null for formats MCP clients cannot render inline", () => {
    expect(imageBlock("AAAA", "SVG")).toBeNull();
    expect(imageBlock("AAAA", "PDF")).toBeNull();
  });

  test("returns null for empty data rather than an empty image", () => {
    expect(imageBlock("", "PNG")).toBeNull();
  });
});
