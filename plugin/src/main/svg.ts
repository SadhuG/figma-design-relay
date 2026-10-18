/**
 * create_svg's plugin half. The server has already resolved the source to
 * markup and checked its size; Figma's `createNodeFromSvg` does the parsing.
 * The Figma calls arrive as parameters so the order — parent first, then
 * create, then place — and the cleanup on failure are tested under Bun.
 */

export interface SvgPlacement {
  name?: string;
  parentId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface SvgResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  parentId: string | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
  childCount: number;
}

export interface SvgApi {
  createNodeFromSvg(svg: string): FrameNode;
  /** Resolves a parent, loading a page first; throws for anything that cannot hold children. */
  getParentNodeById(id: string): Promise<BaseNode & ChildrenMixin>;
}

/**
 * Creates editable vector layers from SVG markup.
 * @param svgText - The markup the server resolved from `source`.
 * @param placement - Optional name, parent, position and size.
 * @param api - The Figma calls.
 * @throws Before creating anything for blank markup or a bad parent; after
 *   creating, any failure removes the new node before rethrowing.
 */
export async function createSvg(
  svgText: string,
  placement: SvgPlacement,
  api: SvgApi
): Promise<SvgResult> {
  if (typeof svgText !== "string" || svgText.trim().length === 0) {
    throw new Error("svgText is required for create_svg. Pass SVG markup or a .svg file path.");
  }

  // createNodeFromSvg inserts the node on the current page at once, so a bad
  // parent found afterwards would leave an orphan behind: resolve it first.
  const parent =
    typeof placement.parentId === "string"
      ? await api.getParentNodeById(placement.parentId)
      : undefined;

  const node = api.createNodeFromSvg(svgText);
  try {
    if (typeof placement.name === "string") node.name = placement.name;
    if (typeof placement.width === "number" || typeof placement.height === "number") {
      node.resize(placement.width ?? node.width, placement.height ?? node.height);
    }
    parent?.appendChild(node);
    // After the append, so x/y are relative to the final parent.
    if (typeof placement.x === "number") node.x = placement.x;
    if (typeof placement.y === "number") node.y = placement.y;
  } catch (err) {
    if (!node.removed) node.remove();
    throw err;
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    parentId: node.parent?.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    childCount: node.children.length,
  };
}
