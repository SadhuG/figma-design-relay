/**
 * The seven layout helpers: fit_to_content, distribute_horizontally/vertically,
 * align_to_grid, place_below, place_right_of and duplicate_with_offset.
 *
 * Positions are a node's local x/y, so every helper that relates nodes to each
 * other asks for siblings under one freely positioned parent: mixing parents
 * would mix coordinate systems, and an auto-layout parent places its children
 * itself. Rotated bounds are refused where width/height would be wrong. Every
 * input is resolved and checked before the first write, and
 * duplicate_with_offset removes its clones if any step fails.
 */

export type LayoutRequestType =
  | "fit_to_content"
  | "distribute_horizontally"
  | "distribute_vertically"
  | "align_to_grid"
  | "place_below"
  | "place_right_of"
  | "duplicate_with_offset";

export interface LayoutParams {
  padding?: number;
  gridSize?: number;
  relativeToId?: string;
  gap?: number;
  align?: "start" | "center";
  offsetX?: number;
  offsetY?: number;
}

export interface LayoutApi {
  /** Resolves a scene node, throwing an actionable error when it does not exist. */
  getSceneNodeById(id: string): Promise<SceneNode>;
}

/** The geometry this module reads and writes. */
type Positioned = SceneNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  layoutPositioning?: string;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const refuse = (message: string): never => {
  throw new Error(message);
};

const assertDistinct = (type: string, ids: readonly string[]): void => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) refuse(`${type} lists ${id} twice. Pass each node once.`);
    seen.add(id);
  }
};

const resolveAll = async (ids: readonly string[], api: LayoutApi): Promise<Positioned[]> => {
  const nodes: Positioned[] = [];
  for (const id of ids) nodes.push((await api.getSceneNodeById(id)) as Positioned);
  return nodes;
};

const isRotated = (node: Positioned): boolean =>
  isFiniteNumber(node.rotation) && Math.abs(node.rotation) > 1e-9;

/** True when an auto-layout parent decides where this node goes. */
const isParentControlled = (node: Positioned): boolean => {
  const parent = node.parent as (BaseNode & { layoutMode?: string }) | null;
  return (
    !!parent &&
    typeof parent.layoutMode === "string" &&
    parent.layoutMode !== "NONE" &&
    node.layoutPositioning !== "ABSOLUTE"
  );
};

const assertFreelyPositioned = (type: string, node: Positioned): void => {
  // Read the id first: the typings give every SceneNode x/y, so the failing
  // branch of the `in` check narrows `node` to never.
  const id = node.id;
  if (!("x" in node) || !("y" in node)) refuse(`${type}: ${id} cannot be positioned.`);
  if (isParentControlled(node)) {
    refuse(
      `${type}: ${node.id} sits in an auto-layout frame, which positions it. Use set_auto_layout to change spacing there, or move it out first.`
    );
  }
};

const assertUnrotated = (type: string, node: Positioned): void => {
  if (isRotated(node)) {
    refuse(
      `${type}: ${node.id} is rotated, so its width and height are not its extent on the canvas. Set its rotation to 0 first.`
    );
  }
};

/** Siblings under one parent, freely positioned and unrotated. */
const assertArrangeable = (type: string, nodes: Positioned[]): void => {
  const parent = nodes[0]?.parent?.id;
  for (const node of nodes) {
    if (node.parent?.id !== parent) {
      refuse(
        `${type} needs nodes with the same parent, since x/y are relative to it. ${node.id} has a different parent from ${nodes[0].id}; reparent_nodes can bring them together.`
      );
    }
    assertFreelyPositioned(type, node);
    assertUnrotated(type, node);
  }
};

/** -0 reads as a bug in results; positions never need it. */
const clean = (value: number): number => (Object.is(value, -0) ? 0 : value);

async function distribute(
  type: "distribute_horizontally" | "distribute_vertically",
  ids: readonly string[],
  api: LayoutApi
) {
  if (ids.length < 3) refuse(`${type} needs at least 3 nodes; the first and last stay put.`);
  assertDistinct(type, ids);
  const nodes = await resolveAll(ids, api);
  assertArrangeable(type, nodes);

  const horizontal = type === "distribute_horizontally";
  const pos = (n: Positioned) => (horizontal ? n.x : n.y);
  const size = (n: Positioned) => (horizontal ? n.width : n.height);
  const sorted = [...nodes].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSize = sorted.reduce((sum, n) => sum + size(n), 0);
  const gap = (pos(last) + size(last) - pos(first) - totalSize) / (sorted.length - 1);

  // First and last keep their exact positions; only the ones between move.
  const results: Array<Record<string, unknown>> = [];
  let cursor = pos(first) + size(first);
  for (const node of sorted.slice(1, -1)) {
    const next = cursor + gap;
    if (horizontal) node.x = next;
    else node.y = next;
    results.push({ nodeId: node.id, [horizontal ? "x" : "y"]: next });
    cursor = next + size(node);
  }
  return {
    axis: horizontal ? "horizontal" : "vertical",
    gap,
    movedCount: results.length,
    results,
  };
}

async function alignToGrid(ids: readonly string[], params: LayoutParams, api: LayoutApi) {
  const gridSize = params.gridSize;
  if (!isFiniteNumber(gridSize) || gridSize <= 0) {
    refuse("align_to_grid needs a positive gridSize.");
  }
  const grid = gridSize as number;
  if (ids.length === 0) refuse("align_to_grid needs at least one node id.");
  assertDistinct("align_to_grid", ids);
  const nodes = await resolveAll(ids, api);
  for (const node of nodes) assertFreelyPositioned("align_to_grid", node);

  const results = nodes.map((node) => {
    node.x = clean(Math.round(node.x / grid) * grid);
    node.y = clean(Math.round(node.y / grid) * grid);
    return { nodeId: node.id, x: node.x, y: node.y };
  });
  return { gridSize: grid, updatedCount: results.length, results };
}

async function placeRelative(
  type: "place_below" | "place_right_of",
  ids: readonly string[],
  params: LayoutParams,
  api: LayoutApi
) {
  const nodeId = ids[0];
  if (!nodeId) refuse(`${type} needs the id of the node to move.`);
  const relativeToId = params.relativeToId;
  if (typeof relativeToId !== "string") refuse(`${type} needs relativeToId, the reference node.`);
  if (relativeToId === nodeId) refuse(`${type} cannot place ${nodeId} relative to itself.`);
  const gap = params.gap ?? 0;
  if (!isFiniteNumber(gap) || gap < 0) refuse(`${type} needs a gap of 0 or more.`);
  const center = params.align === "center";

  const [target, reference] = await resolveAll([nodeId, relativeToId as string], api);
  assertArrangeable(type, [reference, target]);

  if (type === "place_below") {
    target.y = reference.y + reference.height + gap;
    target.x = center ? reference.x + (reference.width - target.width) / 2 : reference.x;
  } else {
    target.x = reference.x + reference.width + gap;
    target.y = center ? reference.y + (reference.height - target.height) / 2 : reference.y;
  }
  return { nodeId: target.id, nodeName: target.name, x: target.x, y: target.y };
}

type SectionLike = Positioned & {
  children: readonly Positioned[];
  resizeWithoutConstraints(width: number, height: number): void;
};

async function fitToContent(ids: readonly string[], params: LayoutParams, api: LayoutApi) {
  const nodeId = ids[0];
  if (!nodeId) refuse("fit_to_content needs a section id.");
  const padding = params.padding ?? 0;
  if (!isFiniteNumber(padding) || padding < 0)
    refuse("fit_to_content needs a padding of 0 or more.");

  const section = (await api.getSceneNodeById(nodeId)) as SectionLike;
  if (section.type !== "SECTION") {
    refuse(
      `fit_to_content only supports SECTION nodes (got ${section.type}: ${nodeId}). For a frame, use set_auto_layout with hug sizing.`
    );
  }
  const children = [...section.children];
  for (const node of children) assertUnrotated("fit_to_content", node);

  if (children.length === 0) {
    const size = Math.max(padding * 2, 0.01);
    section.resizeWithoutConstraints(size, size);
  } else {
    const minX = Math.min(...children.map((c) => c.x));
    const minY = Math.min(...children.map((c) => c.y));
    const maxX = Math.max(...children.map((c) => c.x + c.width));
    const maxY = Math.max(...children.map((c) => c.y + c.height));
    // The section keeps its origin; its children move so their box starts at
    // the padding. That moves them on the canvas — this is not a crop.
    const shiftX = padding - minX;
    const shiftY = padding - minY;
    if (shiftX !== 0 || shiftY !== 0) {
      for (const node of children) {
        node.x += shiftX;
        node.y += shiftY;
      }
    }
    section.resizeWithoutConstraints(
      Math.max(maxX - minX + padding * 2, 0.01),
      Math.max(maxY - minY + padding * 2, 0.01)
    );
  }
  return {
    nodeId: section.id,
    nodeName: section.name,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
    childCount: children.length,
  };
}

type Clonable = Positioned & { clone(): Positioned };

type Container = BaseNode & {
  readonly children: readonly BaseNode[];
  insertChild(index: number, child: SceneNode): void;
};

/**
 * Refuses a layer inside an instance. Figma accepts no new children anywhere
 * in an instance, so its copy could never sit beside the original.
 */
export function assertDuplicableInPlace(type: string, node: BaseNode): void {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "INSTANCE") {
      refuse(
        `${type}: ${node.id} sits inside the instance ${parent.id}, and Figma cannot add a copy there. Duplicate the instance instead, or detach it first.`
      );
    }
  }
}

/**
 * Moves a copy next to its original. Figma parents the clone of a node on
 * another page under the current page — seen live — which would put the copy,
 * and its offset, in the wrong place entirely.
 */
export function keepBesideOriginal(original: SceneNode, copy: SceneNode): void {
  const parent = original.parent as Container | null;
  if (!parent || copy.parent?.id === parent.id) return;
  const index = parent.children.findIndex((child) => child.id === original.id);
  parent.insertChild(index + 1, copy);
}

async function duplicateWithOffset(ids: readonly string[], params: LayoutParams, api: LayoutApi) {
  const { offsetX, offsetY } = params;
  if (!isFiniteNumber(offsetX) || !isFiniteNumber(offsetY)) {
    refuse("duplicate_with_offset needs numeric offsetX and offsetY.");
  }
  if (ids.length === 0) refuse("duplicate_with_offset needs at least one node id.");
  assertDistinct("duplicate_with_offset", ids);
  const nodes = (await resolveAll(ids, api)) as Clonable[];
  for (const node of nodes) {
    if (typeof node.clone !== "function") {
      refuse(`duplicate_with_offset: ${node.id} (${node.type}) does not support duplication.`);
    }
    assertFreelyPositioned("duplicate_with_offset", node);
    assertDuplicableInPlace("duplicate_with_offset", node);
  }

  const created: Positioned[] = [];
  try {
    const duplicates = nodes.map((node) => {
      // The copy is moved beside its original, so the offset is in that parent's space.
      const copy = node.clone();
      created.push(copy);
      keepBesideOriginal(node, copy);
      copy.x = node.x + (offsetX as number);
      copy.y = node.y + (offsetY as number);
      return {
        sourceNodeId: node.id,
        nodeId: copy.id,
        nodeName: copy.name,
        parentId: copy.parent?.id,
        x: copy.x,
        y: copy.y,
      };
    });
    return { duplicatedCount: duplicates.length, duplicates };
  } catch (err) {
    for (const copy of created) {
      if (!(copy as { removed?: boolean }).removed) copy.remove();
    }
    throw err;
  }
}

/**
 * Runs one layout helper.
 * @param type - The request type.
 * @param nodeIds - Transport ids: the nodes to arrange, or the one node to move/fit.
 * @param params - The helper's options.
 * @param api - Figma lookups.
 * @throws Before any write when an input cannot be honoured.
 */
export async function executeLayoutAction(
  type: LayoutRequestType,
  nodeIds: readonly string[],
  params: LayoutParams,
  api: LayoutApi
): Promise<Record<string, unknown>> {
  switch (type) {
    case "distribute_horizontally":
    case "distribute_vertically":
      return distribute(type, nodeIds, api);
    case "align_to_grid":
      return alignToGrid(nodeIds, params, api);
    case "place_below":
    case "place_right_of":
      return placeRelative(type, nodeIds, params, api);
    case "fit_to_content":
      return fitToContent(nodeIds, params, api);
    case "duplicate_with_offset":
      return duplicateWithOffset(nodeIds, params, api);
  }
}
