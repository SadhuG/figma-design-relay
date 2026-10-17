/**
 * set_node_properties' property patch. Split into a check and an apply so a
 * batch checks every node before it writes to any: an unsupported property on
 * the last node must not leave the first ones changed. The Plugin API has no
 * rollback, so a setter Figma itself rejects mid-batch can still leave earlier
 * nodes written — the check removes only the failures we can predict.
 */

export interface NodePropertyPatch {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  cornerRadius?: number;
}

/** The node shape this module reads: everything optional, as on SceneNode's union. */
type PatchableNode = SceneNode & {
  x?: number;
  y?: number;
  rotation?: number;
  opacity?: number;
  cornerRadius?: number | symbol;
  resize?: (width: number, height: number) => void;
};

/** FigJam reports cornerRadius on these, but read-only. */
const READONLY_CORNER_RADIUS = new Set(["SHAPE_WITH_TEXT", "CONNECTOR"]);

/** Picks the patch's known keys out of request params, ignoring anything else. */
export const readNodePropertyPatch = (params: Record<string, unknown>): NodePropertyPatch => {
  const patch: NodePropertyPatch = {};
  if (typeof params.name === "string") patch.name = params.name;
  for (const key of ["x", "y", "width", "height", "rotation", "opacity", "cornerRadius"] as const) {
    if (typeof params[key] === "number") patch[key] = params[key] as number;
  }
  if (typeof params.visible === "boolean") patch.visible = params.visible;
  return patch;
};

/**
 * Throws if any property in `patch` cannot be set on `node`. Writes nothing.
 * @throws With the node id and the property, so the caller can drop either.
 */
export const preflightNodeProperties = (node: SceneNode, patch: NodePropertyPatch): void => {
  const target = node as PatchableNode;
  const refuse = (what: string) => {
    throw new Error(
      `Node ${node.id} (${node.type}) does not support ${what}. Remove it from the patch or leave that node out of nodeIds.`
    );
  };
  if ((patch.x !== undefined || patch.y !== undefined) && !("x" in target && "y" in target)) {
    refuse("x/y positioning");
  }
  if (
    (patch.width !== undefined || patch.height !== undefined) &&
    typeof target.resize !== "function"
  ) {
    refuse("resizing");
  }
  if (patch.rotation !== undefined && !("rotation" in target)) refuse("rotation");
  if (patch.opacity !== undefined && !("opacity" in target)) refuse("opacity");
  if (
    patch.cornerRadius !== undefined &&
    (!("cornerRadius" in target) || READONLY_CORNER_RADIUS.has(node.type))
  ) {
    refuse("setting cornerRadius");
  }
};

/**
 * Applies `patch` to `node` and returns what was set, read back from the node.
 * Call `preflightNodeProperties` first; this does not re-check.
 */
export const applyNodeProperties = (
  node: SceneNode,
  patch: NodePropertyPatch
): Record<string, unknown> => {
  const target = node as PatchableNode;
  const applied: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    node.name = patch.name;
    applied.name = node.name;
  }
  if (patch.visible !== undefined) {
    node.visible = patch.visible;
    applied.visible = node.visible;
  }
  if (patch.x !== undefined || patch.y !== undefined) {
    if (patch.x !== undefined) target.x = patch.x;
    if (patch.y !== undefined) target.y = patch.y;
    applied.x = target.x;
    applied.y = target.y;
  }
  if (patch.width !== undefined || patch.height !== undefined) {
    target.resize!(patch.width ?? node.width, patch.height ?? node.height);
    applied.width = node.width;
    applied.height = node.height;
  }
  if (patch.rotation !== undefined) {
    target.rotation = patch.rotation;
    applied.rotation = target.rotation;
  }
  if (patch.opacity !== undefined) {
    target.opacity = patch.opacity;
    applied.opacity = target.opacity;
  }
  if (patch.cornerRadius !== undefined) {
    target.cornerRadius = patch.cornerRadius;
    applied.cornerRadius = target.cornerRadius;
  }
  return applied;
};
