import { describe, expect, test } from "bun:test";
import { assertEditorSupports, CAPABILITIES } from "./capabilities";

/**
 * Asserts properties rather than a list, so it keeps working as tools are
 * added: nothing may become design-only, or reach Dev Mode, without a decision
 * written down here.
 */

/** Tools that are legitimately design-only. Adding to this list is a decision. */
const DESIGN_ONLY_BY_DESIGN = new Set([
  "set_text_properties",
  "set_gradient_fill",
  "set_effects",
  "set_stroke_properties",
  "set_auto_layout",
  "create_page",
  "create_frame",
  "create_shape",
  "create_image",
  "import_html_layers",
  "import_library_asset",
  "apply_animation_style",
  "remove_animation_style",
  "apply_manual_keyframe_track",
  "remove_manual_keyframe_track",
  "set_timeline_duration",
]);

describe("capability regression", () => {
  test("no tool became design-only without being listed", () => {
    for (const [tool, capability] of Object.entries(CAPABILITIES)) {
      if (capability.editors.length === 1 && capability.editors[0] === "figma") {
        expect(DESIGN_ONLY_BY_DESIGN.has(tool), `${tool} is design-only but not listed`).toBe(true);
      }
    }
  });

  test("every listed design-only tool still works in design files", () => {
    for (const tool of DESIGN_ONLY_BY_DESIGN) {
      expect(() => assertEditorSupports(tool, "figma")).not.toThrow();
    }
  });

  test("no tool is allowed in Dev Mode by accident", () => {
    for (const [tool, capability] of Object.entries(CAPABILITIES)) {
      expect(capability.editors.includes("dev"), `${tool} allows writes in Dev Mode`).toBe(false);
    }
  });

  test("every FigJam-only tool refuses the design editor with a FigJam message", () => {
    for (const [tool, capability] of Object.entries(CAPABILITIES)) {
      if (capability.editors.length === 1 && capability.editors[0] === "figjam") {
        expect(() => assertEditorSupports(tool, "figma")).toThrow(/FigJam/);
      }
    }
  });
});
