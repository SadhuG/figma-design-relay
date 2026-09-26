/**
 * Which tools work in which Figma editor.
 *
 * Before phase 6 the relay knew one fact — Dev Mode is read-only — because it
 * only ran in design files. Opening FigJam and Slides makes editor differences
 * structural: `figma.createPage()` does not exist outside design files, sticky
 * notes and connectors exist only in FigJam, slide nodes only in Slides.
 *
 * Anything absent from this table is allowed everywhere. That keeps read tools
 * and future additions working by default; only genuine restrictions are listed.
 *
 * `editor` is passed in rather than read from the `figma` global so the gate
 * stays unit-testable under Bun — Dev Mode needs a paid seat, so a test is the
 * only way its refusals get exercised.
 */

export type EditorType = "figma" | "figjam" | "slides" | "dev";

export interface Capability {
  editors: EditorType[];
  /** Appended to the refusal so the caller learns why, not just that. */
  reason?: string;
}

const EDITOR_LABEL: Record<EditorType, string> = {
  figma: "design editor",
  figjam: "FigJam",
  slides: "Slides",
  dev: "Dev Mode",
};

/** Where the plugin is, as the refusal's sentence needs it. */
const CURRENT_LABEL: Record<EditorType, string> = {
  figma: "the design editor",
  figjam: "FigJam",
  slides: "Slides",
  dev: "Dev Mode",
};

/** What kind of file to open instead, for the refusal's next step. */
const FILE_LABEL: Record<EditorType, string> = {
  figma: "design file",
  figjam: "FigJam board",
  slides: "Slides deck",
  dev: "design file in Dev Mode",
};

/** Editors that can be written to at all. Dev Mode never can. */
const EDITABLE: EditorType[] = ["figma", "figjam", "slides"];

const DESIGN_ONLY: EditorType[] = ["figma"];
const FIGJAM_ONLY: EditorType[] = ["figjam"];

const designWrite = (reason?: string): Capability => ({ editors: DESIGN_ONLY, reason });

export const CAPABILITIES: Record<string, Capability> = {
  // Design writes. Every one of these existed before phase 6 and must keep
  // behaving identically in `figma` — see the regression test.
  set_node_visibility: { editors: EDITABLE },
  set_text_content: { editors: EDITABLE },
  set_text_properties: designWrite(),
  set_node_properties: { editors: EDITABLE },
  set_solid_fill: { editors: EDITABLE },
  set_gradient_fill: designWrite(),
  set_effects: designWrite(),
  set_stroke_properties: designWrite(),
  set_auto_layout: designWrite(),
  create_page: designWrite("figma.createPage() does not exist outside design files"),
  create_frame: designWrite(),
  create_text: { editors: EDITABLE },
  create_shape: designWrite(),
  create_image: designWrite(),
  import_html_layers: designWrite(),
  duplicate_nodes: { editors: EDITABLE },
  reparent_nodes: { editors: EDITABLE },
  group_nodes: { editors: EDITABLE },
  ungroup_node: { editors: EDITABLE },
  delete_nodes: { editors: EDITABLE },
  run_script: { editors: EDITABLE },
  import_library_asset: designWrite(),

  // Motion, design only.
  apply_animation_style: designWrite(),
  remove_animation_style: designWrite(),
  apply_manual_keyframe_track: designWrite(),
  remove_manual_keyframe_track: designWrite(),
  set_timeline_duration: designWrite(),

  // FigJam only.
  create_sticky: { editors: FIGJAM_ONLY, reason: "sticky notes exist only in FigJam" },
  create_connector: { editors: FIGJAM_ONLY, reason: "connectors exist only in FigJam" },
  create_shape_with_text: {
    editors: FIGJAM_ONLY,
    reason: "shapes-with-text exist only in FigJam",
  },
  create_section: { editors: ["figma", "figjam"] },
  generate_diagram: { editors: FIGJAM_ONLY, reason: "diagrams are rendered as FigJam boards" },
};

/**
 * Refuses a tool the current editor cannot run.
 * @param tool - The request type.
 * @param editor - `figma.editorType`.
 * @throws When the tool is listed and the editor is not among its editors.
 */
export const assertEditorSupports = (tool: string, editor: EditorType): void => {
  const capability = CAPABILITIES[tool];
  if (!capability) return;
  if (capability.editors.includes(editor)) return;

  const wanted = capability.editors.map((allowed) => EDITOR_LABEL[allowed]).join(" or ");
  const because = capability.reason ? ` (${capability.reason})` : "";
  // Dev Mode sits on a design file, so a design write only needs a mode switch;
  // anything else needs a different file altogether.
  const next =
    editor === "dev" && capability.editors.includes("figma")
      ? "Dev Mode is read-only; switch to the design editor and re-run."
      : `Run the plugin in a ${capability.editors
          .map((allowed) => FILE_LABEL[allowed])
          .join(" or ")} and retry, passing that file's fileKey.`;

  throw new Error(
    `${tool} requires ${wanted}${because}, but the plugin is currently in ${CURRENT_LABEL[editor]}. ${next}`
  );
};
