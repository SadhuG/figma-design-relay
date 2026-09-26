import type {
  Diagram,
  DiagramEdge,
  DiagramNode,
  Direction,
  EdgeCap,
  EdgeStyle,
  NodeShape,
} from "./parse.js";

/**
 * Positions a parsed diagram, so the plugin only has to create what it is given.
 *
 * Flowcharts, ER and state diagrams get a ranked layout: a node's rank is its
 * longest distance from a root once cycles are broken, so a diagram with a
 * loop still terminates and still draws every edge. Sequence diagrams are not
 * graphs in that sense — their meaning is the order of the messages — so they
 * get participants in a row, a lifeline under each, and one row per message,
 * all drawn as free-floating connector segments.
 */

export interface Point {
  x: number;
  y: number;
}

export interface PositionedNode extends DiagramNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A connector drawn between two points rather than two nodes. */
export interface Segment {
  role: "message" | "lifeline";
  start: Point;
  end: Point;
  label?: string;
  style: EdgeStyle;
  startCap?: EdgeCap;
  /** Absent means an arrowhead, as on a DiagramEdge. */
  endCap?: EdgeCap;
}

export interface PositionedDiagram {
  kind: Diagram["kind"];
  direction: Direction;
  nodes: PositionedNode[];
  /** Node-to-node connectors. Empty for a sequence diagram. */
  edges: DiagramEdge[];
  /** Point-to-point connectors. Only a sequence diagram has them. */
  segments: Segment[];
  width: number;
  height: number;
}

// FigJam's shape text is about 16 px; these estimates only need to keep labels
// inside their shapes, not to measure them exactly.
const CHAR_WIDTH = 9;
const LINE_HEIGHT = 22;
const PAD_X = 48;
const PAD_Y = 36;
const MIN_WIDTH = 160;
const MAX_WIDTH = 360;
const MIN_HEIGHT = 80;
const TERMINAL_SIZE = 40;

const GAP_ALONG = 100;
const GAP_ACROSS = 60;

const MESSAGE_ROW = 56;
const LOOP_WIDTH = 60;
const LOOP_HEIGHT = 28;
const LIFELINE_TAIL = 40;

/** Shapes whose drawn outline leaves less room for text than their box. */
const ROOMY: Partial<Record<NodeShape, number>> = { diamond: 1.5, hexagon: 1.2 };

const sizeOf = (node: DiagramNode): { width: number; height: number } => {
  if (node.shape === "start" || node.shape === "end") {
    return { width: TERMINAL_SIZE, height: TERMINAL_SIZE };
  }
  const lines = node.label.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest * CHAR_WIDTH + PAD_X));
  const perLine = Math.max(1, Math.floor((width - PAD_X) / CHAR_WIDTH));
  const wrapped = lines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)),
    0
  );
  const height = Math.max(MIN_HEIGHT, wrapped * LINE_HEIGHT + PAD_Y);

  if (node.shape === "circle") {
    const side = Math.max(width, height);
    return { width: side, height: side };
  }
  const scale = ROOMY[node.shape] ?? 1;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

/**
 * Longest-path ranks over the graph with its back edges removed.
 *
 * A depth-first pass finds the edges that close a cycle; ranking then runs over
 * what is left, which is acyclic, in one topological sweep — linear in the
 * graph, where enumerating paths would be exponential in a dense one.
 */
const rankNodes = (nodes: DiagramNode[], edges: DiagramEdge[]): Map<string, number> => {
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    outgoing.get(edge.from)?.push(edge.to);
    hasIncoming.add(edge.to);
  }

  const state = new Map<string, "open" | "done">();
  const back = new Set<string>();
  const visit = (root: string) => {
    const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
    state.set(root, "open");
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const children = outgoing.get(top.id) ?? [];
      if (top.next >= children.length) {
        state.set(top.id, "done");
        stack.pop();
        continue;
      }
      const child = children[top.next++];
      const seen = state.get(child);
      if (seen === "open") back.add(`${top.id}->${child}`);
      else if (seen === undefined) {
        state.set(child, "open");
        stack.push({ id: child, next: 0 });
      }
    }
  };
  const roots = nodes.filter((node) => !hasIncoming.has(node.id));
  for (const node of [...roots, ...nodes]) if (!state.has(node.id)) visit(node.id);

  const forward = new Map<string, string[]>();
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const [from, targets] of outgoing) {
    for (const to of targets) {
      if (back.has(`${from}->${to}`)) continue;
      forward.set(from, [...(forward.get(from) ?? []), to]);
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }
  }

  const rank = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  for (let at = 0; at < queue.length; at++) {
    const id = queue[at];
    for (const next of forward.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return rank;
};

/** Orders each rank by the mean position of its parents, one pass down, to cut crossings. */
const orderRanks = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  ranks: Map<string, number>
): DiagramNode[][] => {
  const byRank: DiagramNode[][] = [];
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    (byRank[rank] ??= []).push(node);
  }
  const layers = byRank.map((layer) => layer ?? []);

  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    if ((ranks.get(edge.from) ?? 0) < (ranks.get(edge.to) ?? 0)) {
      parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
    }
  }

  const position = new Map<string, number>();
  layers[0]?.forEach((node, index) => position.set(node.id, index));
  for (let rank = 1; rank < layers.length; rank++) {
    const keyed = layers[rank].map((node, index) => {
      const placed = (parents.get(node.id) ?? []).filter((id) => position.has(id));
      const key =
        placed.length > 0
          ? placed.reduce((sum, id) => sum + (position.get(id) ?? 0), 0) / placed.length
          : index;
      return { node, key, index };
    });
    keyed.sort((a, b) => a.key - b.key || a.index - b.index);
    layers[rank] = keyed.map(({ node }) => node);
    layers[rank].forEach((node, index) => position.set(node.id, index));
  }
  return layers;
};

const layoutRanked = (diagram: Diagram): PositionedDiagram => {
  const horizontal = diagram.direction === "LR" || diagram.direction === "RL";
  const reversed = diagram.direction === "BT" || diagram.direction === "RL";
  const layers = orderRanks(diagram.nodes, diagram.edges, rankNodes(diagram.nodes, diagram.edges));
  const sizes = new Map(diagram.nodes.map((node) => [node.id, sizeOf(node)]));
  const along = (id: string) => (horizontal ? sizes.get(id)!.width : sizes.get(id)!.height);
  const across = (id: string) => (horizontal ? sizes.get(id)!.height : sizes.get(id)!.width);

  const ordered = reversed ? [...layers].reverse() : layers;
  const thickness = ordered.map((layer) => Math.max(0, ...layer.map((node) => along(node.id))));
  const span = ordered.map(
    (layer) =>
      layer.reduce((sum, node) => sum + across(node.id), 0) +
      GAP_ACROSS * Math.max(0, layer.length - 1)
  );
  const widest = Math.max(0, ...span);

  const placed = new Map<string, PositionedNode>();
  let alongAt = 0;
  ordered.forEach((layer, index) => {
    let acrossAt = (widest - span[index]) / 2;
    for (const node of layer) {
      const { width, height } = sizes.get(node.id)!;
      const alongOffset = alongAt + (thickness[index] - along(node.id)) / 2;
      placed.set(node.id, {
        ...node,
        x: Math.round(horizontal ? alongOffset : acrossAt),
        y: Math.round(horizontal ? acrossAt : alongOffset),
        width,
        height,
      });
      acrossAt += across(node.id) + GAP_ACROSS;
    }
    alongAt += thickness[index] + GAP_ALONG;
  });

  const nodes = diagram.nodes.map((node) => placed.get(node.id)!);
  return {
    kind: diagram.kind,
    direction: diagram.direction,
    nodes,
    edges: diagram.edges,
    segments: [],
    width: Math.max(0, ...nodes.map((node) => node.x + node.width)),
    height: Math.max(0, ...nodes.map((node) => node.y + node.height)),
  };
};

const layoutSequence = (diagram: Diagram): PositionedDiagram => {
  const sizes = diagram.nodes.map(sizeOf);
  const header = Math.max(...sizes.map((size) => size.height));
  const longestMessage = Math.max(0, ...diagram.edges.map((edge) => edge.label?.length ?? 0));
  const labelRoom = longestMessage * CHAR_WIDTH + GAP_ACROSS;

  const centers: number[] = [];
  sizes.forEach((size, index) => {
    if (index === 0) {
      centers.push(size.width / 2);
      return;
    }
    const previous = sizes[index - 1];
    const room = Math.max(previous.width / 2 + size.width / 2 + GAP_ACROSS, labelRoom);
    centers.push(centers[index - 1] + room);
  });

  const nodes: PositionedNode[] = diagram.nodes.map((node, index) => ({
    ...node,
    x: Math.round(centers[index] - sizes[index].width / 2),
    y: 0,
    width: sizes[index].width,
    height: sizes[index].height,
  }));
  const centerOf = new Map(diagram.nodes.map((node, index) => [node.id, centers[index]]));

  const messages: Segment[] = [];
  let y = header + MESSAGE_ROW;
  for (const edge of diagram.edges) {
    const from = centerOf.get(edge.from)!;
    const to = centerOf.get(edge.to)!;
    const base = { role: "message" as const, style: edge.style };
    if (edge.from === edge.to) {
      // A connector cannot start and end at one point, so a self-message is
      // drawn as three: out, down, and back with the arrowhead.
      const out = from + LOOP_WIDTH;
      messages.push(
        {
          ...base,
          start: { x: from, y },
          end: { x: out, y },
          ...(edge.label ? { label: edge.label } : {}),
          endCap: "none",
        },
        { ...base, start: { x: out, y }, end: { x: out, y: y + LOOP_HEIGHT }, endCap: "none" },
        {
          ...base,
          start: { x: out, y: y + LOOP_HEIGHT },
          end: { x: from, y: y + LOOP_HEIGHT },
          ...(edge.endCap ? { endCap: edge.endCap } : {}),
        }
      );
      y += LOOP_HEIGHT + MESSAGE_ROW;
      continue;
    }
    messages.push({
      ...base,
      start: { x: from, y },
      end: { x: to, y },
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.startCap ? { startCap: edge.startCap } : {}),
      ...(edge.endCap ? { endCap: edge.endCap } : {}),
    });
    y += MESSAGE_ROW;
  }

  const bottom = y - MESSAGE_ROW + LIFELINE_TAIL;
  const lifelines: Segment[] = centers.map((center) => ({
    role: "lifeline",
    start: { x: center, y: header },
    end: { x: center, y: Math.max(bottom, header + LIFELINE_TAIL) },
    style: "dashed",
    endCap: "none",
  }));

  const segments = [...lifelines, ...messages];
  const points = segments.flatMap((segment) => [segment.start, segment.end]);
  return {
    kind: diagram.kind,
    direction: diagram.direction,
    nodes,
    edges: [],
    segments,
    width: Math.max(...nodes.map((node) => node.x + node.width), ...points.map((point) => point.x)),
    height: Math.max(header, ...points.map((point) => point.y)),
  };
};

/**
 * Assigns coordinates to every node in a parsed diagram.
 * @param diagram - The parsed diagram.
 * @returns Positioned nodes, the connectors to draw, and the bounding box.
 */
export const layoutDiagram = (diagram: Diagram): PositionedDiagram =>
  diagram.kind === "sequence" ? layoutSequence(diagram) : layoutRanked(diagram);
