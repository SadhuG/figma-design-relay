import { describe, expect, test } from "bun:test";
import { assertEditorSupports, CAPABILITIES } from "./capabilities";

const DESIGN_WRITES = [
  "set_node_visibility",
  "set_text_content",
  "set_text_properties",
  "set_node_properties",
  "set_solid_fill",
  "set_gradient_fill",
  "set_effects",
  "set_stroke_properties",
  "set_auto_layout",
  "create_page",
  "create_frame",
  "create_text",
  "create_shape",
  "create_image",
  "import_html_layers",
  "duplicate_nodes",
  "reparent_nodes",
  "group_nodes",
  "ungroup_node",
  "delete_nodes",
];

describe("design files keep working", () => {
  test("every existing write tool is allowed in the design editor", () => {
    for (const tool of DESIGN_WRITES) {
      expect(() => assertEditorSupports(tool, "figma")).not.toThrow();
    }
  });

  test("every existing write tool is still refused in Dev Mode", () => {
    for (const tool of DESIGN_WRITES) {
      expect(() => assertEditorSupports(tool, "dev")).toThrow();
    }
  });

  test("reads are allowed in every editor", () => {
    for (const editor of ["figma", "figjam", "slides", "dev"] as const) {
      expect(() => assertEditorSupports("get_document", editor)).not.toThrow();
      expect(() => assertEditorSupports("get_selection", editor)).not.toThrow();
    }
  });
});

describe("assertEditorSupports", () => {
  test("create_page is design-only, because the API does not exist elsewhere", () => {
    expect(() => assertEditorSupports("create_page", "figjam")).toThrow(/design/i);
    expect(() => assertEditorSupports("create_page", "slides")).toThrow(/design/i);
  });

  test("FigJam writes are refused in design files", () => {
    expect(() => assertEditorSupports("create_sticky", "figma")).toThrow(/figjam/i);
  });

  test("the message names the editor the caller is in and the one the tool needs", () => {
    expect(() => assertEditorSupports("create_sticky", "figma")).toThrow(
      /currently in the design editor/i
    );
  });

  test("the full refusal reads as one instruction", () => {
    expect(() => assertEditorSupports("create_page", "figjam")).toThrow(
      "create_page requires design editor (figma.createPage() does not exist outside design files), but the plugin is currently in FigJam. Run the plugin in a design file and retry, passing that file's fileKey."
    );
  });

  test("the message says what to do next", () => {
    expect(() => assertEditorSupports("create_sticky", "figma")).toThrow(
      /run the plugin in a FigJam board and retry/i
    );
  });

  test("Dev Mode points back at the design editor for a design write", () => {
    expect(() => assertEditorSupports("run_script", "dev")).toThrow(
      /Dev Mode is read-only; switch to the design editor and re-run/
    );
  });

  test("Dev Mode does not send a FigJam tool to the design editor", () => {
    expect(() => assertEditorSupports("create_sticky", "dev")).not.toThrow(/design editor/);
    expect(() => assertEditorSupports("create_sticky", "dev")).toThrow(/FigJam board/);
  });

  test("the phase 5 writes and reads keep their Dev Mode behaviour", () => {
    expect(() => assertEditorSupports("import_library_asset", "dev")).toThrow();
    expect(() => assertEditorSupports("whoami", "dev")).not.toThrow();
    expect(() => assertEditorSupports("get_libraries", "dev")).not.toThrow();
  });

  // The table is keyed by the request type the plugin receives. generate_diagram
  // is the MCP tool; what reaches the dispatcher is render_diagram.
  test("the diagram renderer is gated under the request type the plugin receives", () => {
    expect(() => assertEditorSupports("render_diagram", "figma")).toThrow(/FigJam board/);
    expect(() => assertEditorSupports("render_diagram", "figjam")).not.toThrow();
  });

  test("an unknown tool is allowed rather than blocked", () => {
    expect(() => assertEditorSupports("some_future_tool", "figjam")).not.toThrow();
  });

  test("every capability lists at least one editor", () => {
    for (const [tool, capability] of Object.entries(CAPABILITIES)) {
      expect(capability.editors.length, `${tool} allows no editors`).toBeGreaterThan(0);
    }
  });
});

describe("slides scope", () => {
  test("reads and screenshots work", () => {
    expect(() => assertEditorSupports("get_document", "slides")).not.toThrow();
    expect(() => assertEditorSupports("get_screenshot", "slides")).not.toThrow();
  });

  test("text edits inside existing slides work", () => {
    expect(() => assertEditorSupports("set_text_content", "slides")).not.toThrow();
    expect(() => assertEditorSupports("set_node_properties", "slides")).not.toThrow();
  });

  test("creating design structure is out of scope", () => {
    expect(() => assertEditorSupports("create_frame", "slides")).toThrow(/design editor/i);
    expect(() => assertEditorSupports("create_page", "slides")).toThrow();
  });

  test("FigJam-only tools are refused", () => {
    expect(() => assertEditorSupports("create_sticky", "slides")).toThrow(/figjam/i);
  });

  test("sections are refused, since Slides has no canvas to section", () => {
    expect(() => assertEditorSupports("create_section", "slides")).toThrow(/Slides/);
  });
});
