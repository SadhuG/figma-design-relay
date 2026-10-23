import { describe, expect, test } from "bun:test";
import { UI_COLLAPSED_HEIGHT, UI_WIDTH, uiExpandedHeight } from "./panel-size";

describe("panel size", () => {
  test("the stable panel opens at 121: rows 81 + spacer 4 + footer 36", () => {
    expect(uiExpandedHeight(false)).toBe(121);
  });

  test("a dev build adds the Theme row: 18 px and a 6 px gap", () => {
    expect(uiExpandedHeight(true)).toBe(145);
  });

  test("collapsed is the bar alone in both builds, 320 wide", () => {
    expect(UI_COLLAPSED_HEIGHT).toBe(36);
    expect(UI_WIDTH).toBe(320);
  });
});
