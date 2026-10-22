import { describe, expect, test } from "bun:test";
import { THEME_OVERRIDE_KEY, parseThemeOverride } from "./theme-override";

describe("parseThemeOverride", () => {
  test("keeps light and dark", () => {
    expect(parseThemeOverride("light")).toBe("light");
    expect(parseThemeOverride("dark")).toBe("dark");
  });

  test("treats anything else as following Figma", () => {
    for (const stored of [null, undefined, "blue", 1, {}, "Dark", true]) {
      expect(parseThemeOverride(stored)).toBeNull();
    }
  });

  test("is stored under theme-override", () => {
    expect(THEME_OVERRIDE_KEY).toBe("theme-override");
  });
});
