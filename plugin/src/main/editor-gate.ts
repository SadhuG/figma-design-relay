import type { RequestType } from "./code";

/**
 * Tools that mutate the document. Dev Mode is read-only, so these are refused
 * before dispatch rather than left to fail deep inside the Plugin API.
 */
export const EDIT_REQUEST_TYPES = new Set<RequestType>([
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
  "apply_animation_style",
  "remove_animation_style",
  "apply_manual_keyframe_track",
  "remove_manual_keyframe_track",
  "set_timeline_duration",
  "run_script",
]);

/**
 * Reject an edit tool when the plugin is running in Dev Mode.
 *
 * `editorType` is passed in rather than read from the `figma` global so this
 * stays unit-testable under Bun — Dev Mode itself needs a paid Figma seat, so
 * a test is the only way this gate gets exercised.
 */
export const requireEditorMode = (toolName: RequestType, editorType: string): void => {
  // Dev Mode is read-only — every figma.create*/setter throws at runtime there,
  // and the resulting errors are confusing. Reject up front with a clear hint.
  if (editorType === "dev") {
    throw new Error(
      `${toolName} requires the plugin to be opened in Figma's design editor (Dev Mode is read-only). Switch to the design editor and re-run.`
    );
  }
};
