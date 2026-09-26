import { describe, expect, test } from "bun:test";
import { EDIT_REQUEST_TYPES, requireEditorMode } from "./editor-gate";

describe("requireEditorMode", () => {
  test("rejects an edit tool in Dev Mode", () => {
    expect(() => requireEditorMode("run_script", "dev")).toThrow(
      "run_script requires the plugin to be opened in Figma's design editor (Dev Mode is read-only). Switch to the design editor and re-run."
    );
  });

  test("allows an edit tool in the design editor", () => {
    expect(() => requireEditorMode("run_script", "figma")).not.toThrow();
  });

  test("names the offending tool in the message", () => {
    expect(() => requireEditorMode("delete_nodes", "dev")).toThrow(/^delete_nodes requires/);
  });

  // FigJam and Slides are not read-only, so the gate must key off "dev"
  // specifically rather than "anything that is not figma".
  test("allows edit tools in other non-dev editors", () => {
    expect(() => requireEditorMode("run_script", "figjam")).not.toThrow();
    expect(() => requireEditorMode("run_script", "slides")).not.toThrow();
  });
});

describe("EDIT_REQUEST_TYPES", () => {
  test("gates run_script", () => {
    expect(EDIT_REQUEST_TYPES.has("run_script")).toBe(true);
  });

  test("does not gate read-only tools", () => {
    expect(EDIT_REQUEST_TYPES.has("get_document")).toBe(false);
    expect(EDIT_REQUEST_TYPES.has("get_selection")).toBe(false);
  });

  test("gates import_library_asset, which writes into the file", () => {
    expect(EDIT_REQUEST_TYPES.has("import_library_asset")).toBe(true);
  });

  test("leaves the phase 5 reads usable in Dev Mode", () => {
    expect(EDIT_REQUEST_TYPES.has("whoami")).toBe(false);
    expect(EDIT_REQUEST_TYPES.has("get_libraries")).toBe(false);
  });
});
