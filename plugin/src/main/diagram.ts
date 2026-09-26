/**
 * The pure half of render_diagram: checks the laid-out graph the server sends
 * and maps its vocabulary onto FigJam's. The dispatcher in code.ts does the
 * creating; everything that can be decided without the `figma` global is
 * decided here, so it is tested under Bun.
 *
 * Validation happens before a single node is created. render_diagram is not a
 * tool name, so the follower → leader hop passes it through unvalidated, and a
 * payload that failed half-way would leave half a diagram on the board.
 */

import type { Box } from "./intent";

type ShapeType = ShapeWithTextNode["shapeType"];
type StrokeCap = ConnectorNode["connectorEndStrokeCap"];
type Magnet = ConnectorEndpointEndpointNodeIdAndMagnet["magnet"];

export interface Point {
  x: number;
  y: number;
}

export interface RenderNode extends Box {
  id: string;
  label: string;
  shape: string;
}

export interface RenderEdge {
  from: string;
  to: string;
  label?: string;
  style: string;
  startCap?: string;
  endCap?: string;
}

export interface RenderSegment {
  role: string;
  start: Point;
  end: Point;
  label?: string;
  style: string;
  startCap?: string;
  endCap?: string;
}

export interface RenderDiagram {
  kind: string;
  nodes: RenderNode[];
  edges: RenderEdge[];
  segments: RenderSegment[];
}

// Maps, not object literals: the payload is unvalidated, and a lookup on an
// object would accept "constructor" or "toString" as a shape or cap.
const SHAPES = new Map<string, ShapeType>([
  ["rect", "SQUARE"],
  ["round", "ROUNDED_RECTANGLE"],
  ["stadium", "ROUNDED_RECTANGLE"],
  ["subroutine", "PREDEFINED_PROCESS"],
  ["cylinder", "ENG_DATABASE"],
  ["circle", "ELLIPSE"],
  ["hexagon", "HEXAGON"],
  ["diamond", "DIAMOND"],
  ["parallelogram", "PARALLELOGRAM_RIGHT"],
  ["parallelogram-alt", "PARALLELOGRAM_LEFT"],
  ["trapezoid", "TRAPEZOID"],
  ["actor", "ROUNDED_RECTANGLE"],
  ["entity", "SQUARE"],
  ["state", "ROUNDED_RECTANGLE"],
  ["start", "ELLIPSE"],
  ["end", "ELLIPSE"],
]);

const CAPS = new Map<string, StrokeCap>([
  ["none", "NONE"],
  ["arrow", "ARROW_EQUILATERAL"],
  ["open-arrow", "ARROW_LINES"],
  ["circle", "CIRCLE_FILLED"],
  ["zero-or-one", "ERD_ZERO_OR_ONE"],
  ["exactly-one", "ERD_EXACTLY_ONE"],
  ["zero-or-more", "ERD_ZERO_OR_MORE"],
  ["one-or-more", "ERD_ONE_OR_MORE"],
]);

const STYLES = new Set(["solid", "dashed", "thick"]);

const malformed = (what: string): never => {
  throw new Error(
    `render_diagram received a malformed diagram: ${what}. Call generate_diagram with Mermaid source instead of render_diagram directly.`
  );
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPoint = (value: unknown): value is Point => {
  const point = value as Point | undefined;
  return isNumber(point?.x) && isNumber(point?.y);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const checkLine = (line: Record<string, unknown>, where: string): void => {
  if (typeof line.style !== "string" || !STYLES.has(line.style)) {
    malformed(`${where} has style ${String(line.style)}`);
  }
  for (const cap of [line.startCap, line.endCap]) {
    if (cap !== undefined && (typeof cap !== "string" || !CAPS.has(cap))) {
      malformed(`${where} has an unknown cap ${String(cap)}`);
    }
  }
  if (line.label !== undefined && typeof line.label !== "string") {
    malformed(`${where} has a non-text label`);
  }
};

/**
 * Checks a laid-out diagram before anything is drawn from it.
 * @param value - `request.params.diagram`.
 * @throws When any part of it cannot be drawn exactly.
 */
export const readDiagramPayload = (value: unknown): RenderDiagram => {
  if (!isRecord(value)) return malformed("no diagram object");
  const { nodes, edges, segments } = value;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(segments)) {
    return malformed("nodes, edges and segments must all be arrays");
  }

  const ids = new Set<string>();
  nodes.forEach((node: unknown, index) => {
    if (!isRecord(node)) return malformed(`node ${index} is not an object`);
    const { id, label, shape, x, y, width, height } = node;
    if (typeof id !== "string" || typeof label !== "string") {
      malformed(`node ${index} lacks an id or label`);
    }
    if (![x, y].every(isNumber) || ![width, height].every((n) => isNumber(n) && n > 0)) {
      malformed(`node ${index} (${String(id)}) has no position or size`);
    }
    shapeFor(shape as string);
    ids.add(id as string);
  });

  edges.forEach((edge: unknown, index) => {
    if (!isRecord(edge)) return malformed(`edge ${index} is not an object`);
    for (const end of [edge.from, edge.to]) {
      if (typeof end !== "string" || !ids.has(end)) {
        malformed(`edge ${index} names ${String(end)}, which is not a node in the diagram`);
      }
    }
    checkLine(edge, `edge ${index}`);
  });

  segments.forEach((segment: unknown, index) => {
    if (!isRecord(segment)) return malformed(`segment ${index} is not an object`);
    if (!isPoint(segment.start) || !isPoint(segment.end)) {
      malformed(`segment ${index} has no start or end point`);
    }
    checkLine(segment, `segment ${index}`);
  });

  return {
    kind: typeof value.kind === "string" ? value.kind : "diagram",
    nodes: nodes as RenderNode[],
    edges: edges as RenderEdge[],
    segments: segments as RenderSegment[],
  };
};

/**
 * The FigJam shape that draws a parser shape.
 * @throws For a shape with no FigJam equivalent — never substitutes one.
 */
export const shapeFor = (shape: string): ShapeType => {
  const mapped = SHAPES.get(shape);
  if (!mapped) return malformed(`shape "${shape}" has no FigJam equivalent`);
  return mapped;
};

/**
 * The connector cap for one end of a link.
 * @param cap - The parser's cap, or undefined for that end's default.
 * @param end - Which end: a link's start defaults to no cap, its end to an arrow.
 */
export const capFor = (cap: string | undefined, end: "start" | "end"): StrokeCap =>
  CAPS.get(cap ?? (end === "start" ? "none" : "arrow")) ?? "NONE";

/**
 * The sides a connector attaches to. FigJam picks them between two nodes, but
 * AUTO on both ends of a self-loop collapses the connector to a point.
 */
export const connectorMagnets = (from: string, to: string): { start: Magnet; end: Magnet } =>
  from === to ? { start: "RIGHT", end: "TOP" } : { start: "AUTO", end: "AUTO" };

interface Removable {
  readonly removed: boolean;
  remove(): void;
}

/**
 * Runs `work`, and if it throws removes every node in `created` before
 * rethrowing — the Plugin API has no rollback, so a creator that fails
 * part-way would otherwise leave its half-built nodes on the board.
 * @param created - Filled by `work` as it creates nodes.
 */
export const removeOnFailure = async <T>(
  created: Removable[],
  work: () => Promise<T>
): Promise<T> => {
  try {
    return await work();
  } catch (err) {
    for (const node of created) if (!node.removed) node.remove();
    throw err;
  }
};

/**
 * Wraps `figma.loadFontAsync` so each font loads once per call site — a
 * diagram's shapes and connectors all share a default font, and awaiting it per
 * node adds up inside the bridge's timeout. A failed load is forgotten, so it
 * can be retried.
 */
export const fontLoader = (
  load: (font: FontName) => Promise<void>
): ((font: FontName) => Promise<void>) => {
  const pending = new Map<string, Promise<void>>();
  return (font) => {
    const key = `${font.family}::${font.style}`;
    let loading = pending.get(key);
    if (!loading) {
      loading = load(font).catch((err: unknown) => {
        pending.delete(key);
        throw err;
      });
      pending.set(key, loading);
    }
    return loading;
  };
};

/** How a link style is stroked. */
export const strokeFor = (style: string): { dashPattern: number[]; strokeWeight: number } => {
  if (style === "dashed") return { dashPattern: [8, 8], strokeWeight: 2 };
  if (style === "thick") return { dashPattern: [], strokeWeight: 5 };
  return { dashPattern: [], strokeWeight: 2 };
};

const PLACEMENT_GAP = 200;

/**
 * Where to put a new diagram: to the right of everything already on the page,
 * top-aligned with it, so drawing never covers existing work.
 * @param existing - The bounding boxes of the page's top-level nodes.
 */
export const placementOrigin = (existing: Box[]): Point => {
  if (existing.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...existing.map((box) => box.x + box.width));
  const top = Math.min(...existing.map((box) => box.y));
  return { x: right + PLACEMENT_GAP, y: top };
};
