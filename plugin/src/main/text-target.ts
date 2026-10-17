/**
 * Where a text edit lands. A TEXT node is edited itself; a FigJam STICKY or
 * SHAPE_WITH_TEXT keeps its label in a `.text` sublayer, which takes fonts,
 * characters and fills but has no alignment, auto-resize or bounds of its own.
 * Results report the outer node, since that is the id the caller holds.
 */

export type TextTarget =
  | { kind: "text"; node: TextNode; text: TextNode }
  | { kind: "sublayer"; node: StickyNode | ShapeWithTextNode; text: TextSublayerNode };

/**
 * Resolves the node a text tool should edit.
 * @param id - The node id the caller passed.
 * @param toolName - Named in the refusal.
 * @param getNodeByIdAsync - Figma's lookup.
 * @throws For a missing node or one without editable text.
 */
export async function getTextTargetById(
  id: string,
  toolName: string,
  getNodeByIdAsync: (id: string) => Promise<BaseNode | null>
): Promise<TextTarget> {
  const node = await getNodeByIdAsync(id);
  if (!node) {
    throw new Error(
      `Node ${id} not found in this file. Check the id with get_document or get_selection.`
    );
  }
  if (node.type === "TEXT") return { kind: "text", node, text: node };
  if (node.type === "STICKY" || node.type === "SHAPE_WITH_TEXT") {
    return { kind: "sublayer", node, text: node.text };
  }
  throw new Error(
    `${toolName} supports TEXT, STICKY and SHAPE_WITH_TEXT nodes (got ${node.type}: ${id}). Pick the text layer itself; get_node lists a frame's children.`
  );
}

/** Properties that exist on a TEXT node but not on a FigJam text sublayer. */
const TEXT_ONLY = ["textAlignHorizontal", "textAlignVertical", "textAutoResize"] as const;

/**
 * Refuses set_text_properties options the target cannot take, before any of
 * them is written — a refusal after the font change would leave half a patch.
 */
export function assertTextPropertiesSupported(
  target: TextTarget,
  params: Record<string, unknown>
): void {
  if (target.kind === "text") return;
  const unsupported = TEXT_ONLY.filter((key) => params[key] !== undefined);
  if (unsupported.length > 0) {
    throw new Error(
      `${unsupported.join(", ")} only apply to TEXT nodes; a ${target.node.type}'s text has no alignment or auto-resize setting. Remove ${unsupported.length > 1 ? "them" : "it"} and retry.`
    );
  }
  const resizing = params.width !== undefined || params.height !== undefined;
  if (resizing && typeof (target.node as { resize?: unknown }).resize !== "function") {
    throw new Error(
      `A ${target.node.type} does not support resizing (${target.node.id}). Remove width/height and retry.`
    );
  }
}
