/** Read-only geometry, deliberately independent of screenshot export. */
export async function getLayoutTree(
  rootId: string,
  maxNodes = 2000,
  context: {
    getNodeByIdAsync: (id: string) => Promise<BaseNode | null>;
    fileKey?: string;
    fileName: string;
  }
) {
  const root = await context.getNodeByIdAsync(rootId);
  if (!root || root.type === "DOCUMENT" || root.type === "PAGE")
    throw new Error(
      "Scene root required. Pass a scene node id from get_selection or get_node and retry."
    );
  let page: BaseNode | null = root.parent;
  while (page && page.type !== "PAGE") page = page.parent;
  const nodes: unknown[] = [];
  let truncated = false;
  function visit(node: SceneNode, depth: number) {
    if (nodes.length >= maxNodes || depth > 100) {
      truncated = true;
      return;
    }
    nodes.push({
      id: node.id,
      parentId: node.parent?.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
      localSize: { width: node.width, height: node.height },
      absoluteTransform: node.absoluteTransform,
      absoluteBoundingBox: node.absoluteBoundingBox,
      absoluteRenderBounds: "absoluteRenderBounds" in node ? node.absoluteRenderBounds : null,
      clipsContent: "clipsContent" in node ? node.clipsContent : false,
    });
    if ("children" in node) {
      for (const child of node.children) {
        if (nodes.length >= maxNodes || depth >= 100) {
          truncated = true;
          break;
        }
        visit(child, depth + 1);
      }
    }
  }
  visit(root, 0);
  return {
    schemaVersion: 1,
    snapshotId: new Date().toISOString(),
    atomicWithScreenshot: false,
    fileKey: context.fileKey ?? null,
    fileName: context.fileName,
    pageId: page?.id ?? null,
    rootId,
    truncated,
    nodes,
    capture: {
      coordinateSpace: "document-absolute",
      window: root.absoluteBoundingBox,
      exportSettings: {
        format: "PNG",
        contentsOnly: true,
        useAbsoluteBounds: true,
        constraint: { type: "SCALE", value: 1 },
      },
      dimensionsAreMeasuredFromImage: false,
      clipping:
        "Rectangles are layout AABBs; ancestor masks and painted visibility are not evaluated.",
    },
  };
}
