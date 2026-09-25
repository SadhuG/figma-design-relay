import { describe, expect, test } from "bun:test";
import { parseFigmaUrl } from "./url.js";

describe("parseFigmaUrl", () => {
  test("reads the file key and converts the hyphenated node id", () => {
    expect(
      parseFigmaUrl("https://www.figma.com/design/AbC123/Design-System?node-id=1-2&t=xyz")
    ).toEqual({ fileKey: "AbC123", nodeId: "1:2" });
  });

  test("accepts the legacy /file/ path", () => {
    expect(parseFigmaUrl("https://figma.com/file/AbC123/DS?node-id=10-20")?.nodeId).toBe("10:20");
  });

  test("accepts a node id that already uses a colon", () => {
    expect(parseFigmaUrl("https://figma.com/design/AbC123/DS?node-id=1:2")?.nodeId).toBe("1:2");
  });

  test("returns null without a node id, because a file-only URL maps nothing", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/DS")).toBeNull();
  });

  test("returns null for a non-Figma URL", () => {
    expect(parseFigmaUrl("https://example.com/design/AbC123?node-id=1-2")).toBeNull();
  });

  test("returns null for something that is not a URL at all", () => {
    expect(parseFigmaUrl("Button")).toBeNull();
  });
});
