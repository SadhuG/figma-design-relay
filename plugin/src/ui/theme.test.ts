import { describe, expect, test } from "bun:test";
import { figmaTheme } from "./theme";

describe("figmaTheme", () => {
  test("reads Figma's dark class", () => {
    expect(figmaTheme("figma-dark")).toBe("dark");
  });

  test("reads Figma's light class", () => {
    expect(figmaTheme("figma-light")).toBe("light");
  });

  test("is light with no theme class (a browser preview, an older Figma)", () => {
    expect(figmaTheme("")).toBe("light");
  });

  test("finds the class among others", () => {
    expect(figmaTheme("foo figma-dark bar")).toBe("dark");
  });

  test("matches a whole class only", () => {
    expect(figmaTheme("figma-darker")).toBe("light");
  });
});
