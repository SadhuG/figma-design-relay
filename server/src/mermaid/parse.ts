/**
 * Parses the Mermaid subset the relay renders into FigJam.
 *
 * Deliberately strict. A diagram that renders approximately is worse than one
 * that refuses, because nobody proof-reads a diagram they asked a tool to draw
 * — so every statement either matches a form this module understands or the
 * whole parse throws, naming the line. Nothing is ever skipped silently.
 */

export type DiagramKind = "flowchart" | "sequence" | "er" | "state";

/** Flow direction. TD and TB are the same thing; TB is folded into TD. */
export type Direction = "TD" | "BT" | "LR" | "RL";

export type NodeShape =
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "hexagon"
  | "diamond"
  | "parallelogram"
  | "parallelogram-alt"
  | "trapezoid"
  | "actor"
  | "entity"
  | "state"
  | "start"
  | "end";

/** What sits at one end of an edge. ER cardinalities map to FigJam's crow's-foot caps. */
export type EdgeCap =
  | "none"
  | "arrow"
  | "open-arrow"
  | "circle"
  | "zero-or-one"
  | "exactly-one"
  | "zero-or-more"
  | "one-or-more";

export type EdgeStyle = "solid" | "dashed" | "thick";

export interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style: EdgeStyle;
  /** Absent means no cap, the usual start of a link. */
  startCap?: EdgeCap;
  /** Absent means an arrowhead, the usual end of a link. */
  endCap?: EdgeCap;
}

export interface Diagram {
  kind: DiagramKind;
  direction: Direction;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export const SUPPORTED_DIAGRAMS = "flowchart, sequenceDiagram, erDiagram, stateDiagram-v2";

/** One render is one plugin request inside the bridge's 180 s timeout. */
export const MAX_NODES = 200;
export const MAX_EDGES = 400;

/** Mermaid diagram types that exist but are outside the subset, so the refusal can name them. */
const KNOWN_UNSUPPORTED = new Set(
  [
    "pie",
    "gantt",
    "classDiagram",
    "classDiagram-v2",
    "journey",
    "gitGraph",
    "mindmap",
    "timeline",
    "quadrantChart",
    "requirementDiagram",
    "C4Context",
    "C4Container",
    "C4Component",
    "C4Dynamic",
    "C4Deployment",
    "sankey",
    "sankey-beta",
    "xychart",
    "xychart-beta",
    "block",
    "block-beta",
    "packet",
    "packet-beta",
    "kanban",
    "architecture",
    "architecture-beta",
    "zenuml",
    "radar-beta",
    "treemap",
    "treemap-beta",
  ].map((name) => name.toLowerCase())
);

const HEADERS: Record<string, DiagramKind> = {
  flowchart: "flowchart",
  graph: "flowchart",
  sequencediagram: "sequence",
  erdiagram: "er",
  statediagram: "state",
  "statediagram-v2": "state",
};

interface Statement {
  text: string;
  /** 1-based line in the caller's source, so the error points at what they wrote. */
  line: number;
}

const fail = (line: number, message: string): never => {
  throw new Error(`Line ${line}: ${message}`);
};

/** Splits a line on `;`, except inside brackets, quotes or pipe labels. */
const splitStatements = (line: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let piped = false;
  let current = "";
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "|") piped = !piped;
    else if (!quoted && !piped && "[({".includes(char)) depth++;
    else if (!quoted && !piped && "])}".includes(char)) depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0 && !quoted && !piped) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
};

/** Strips comments and blank lines, keeping statement order and line numbers. */
const statementsOf = (source: string): Statement[] => {
  const statements: Statement[] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/%%.*$/, "");
    for (const part of splitStatements(line)) {
      const text = part.trim();
      if (text !== "") statements.push({ text, line: index + 1 });
    }
  });
  return statements;
};

/** Removes wrapping quotes and turns `<br>` into a line break. */
const cleanLabel = (raw: string): string => {
  let label = raw.trim();
  if (label.length >= 2 && label.startsWith('"') && label.endsWith('"')) {
    label = label.slice(1, -1);
  }
  return label.replace(/<br\s*\/?>/gi, "\n").trim();
};

const readDirection = (token: string): Direction => {
  const upper = token.toUpperCase();
  return upper === "TB" ? "TD" : (upper as Direction);
};

class Builder {
  private readonly order: string[] = [];
  private readonly nodes = new Map<string, DiagramNode>();
  readonly edges: DiagramEdge[] = [];

  /** A bare mention: creates the node if it is new, never changes one that exists. */
  ref(id: string, shape: NodeShape, label = id): string {
    if (!this.nodes.has(id)) {
      this.order.push(id);
      this.nodes.set(id, { id, label, shape });
    }
    return id;
  }

  /** An explicit declaration: sets the label and shape, as Mermaid's last definition wins. */
  declare(id: string, label: string, shape: NodeShape): string {
    const existing = this.nodes.get(id);
    if (existing) {
      existing.label = label;
      existing.shape = shape;
      return id;
    }
    this.order.push(id);
    this.nodes.set(id, { id, label, shape });
    return id;
  }

  get(id: string): DiagramNode | undefined {
    return this.nodes.get(id);
  }

  edge(from: string, to: string, style: EdgeStyle, extra: Partial<DiagramEdge> = {}): void {
    const edge: DiagramEdge = { from, to, style };
    if (extra.label) edge.label = extra.label;
    if (extra.startCap && extra.startCap !== "none") edge.startCap = extra.startCap;
    if (extra.endCap && extra.endCap !== "arrow") edge.endCap = extra.endCap;
    this.edges.push(edge);
  }

  list(): DiagramNode[] {
    return this.order.map((id) => this.nodes.get(id) as DiagramNode);
  }
}

// ---------------------------------------------------------------- flowchart

const FLOW_KEYWORDS = new Set([
  "subgraph",
  "end",
  "direction",
  "classdef",
  "class",
  "style",
  "linkstyle",
  "click",
  "acctitle",
  "accdescr",
  "title",
]);

const FLOW_SUBSET =
  "Supported flowchart syntax: nodes A, A[rect], A(round), A([stadium]), A[[subroutine]], A[(cylinder)], A((circle)), A{diamond}, A{{hexagon}}, A[/parallelogram/], A[\\parallelogram\\], A[/trapezoid\\]; links -->, ---, -.->, -.-, ==>, ===, --o, <-->, with labels as -->|text| or -- text -->.";

/** Delimiter pairs, longest opener first so `((` is not read as `(`. */
const FLOW_SHAPES: Array<[string, string, NodeShape]> = [
  ["((", "))", "circle"],
  ["([", "])", "stadium"],
  ["[(", ")]", "cylinder"],
  ["[[", "]]", "subroutine"],
  ["{{", "}}", "hexagon"],
  ["[", "]", "rect"],
  ["(", ")", "round"],
  ["{", "}", "diamond"],
];

interface FlowNodeRef {
  id: string;
  end: number;
  label?: string;
  shape?: NodeShape;
}

const skipSpace = (text: string, index: number): number => {
  let at = index;
  while (at < text.length && /\s/.test(text[at])) at++;
  return at;
};

/** Reads a label up to `close`, honouring a quoted label that may contain it. */
const readLabel = (
  text: string,
  start: number,
  close: string,
  line: number
): { label: string; end: number } => {
  if (text[start] === '"') {
    const quote = text.indexOf('"', start + 1);
    if (quote < 0) fail(line, `unterminated quoted label.`);
    if (!text.startsWith(close, quote + 1)) {
      fail(line, `expected "${close}" after the quoted label.`);
    }
    return { label: cleanLabel(text.slice(start, quote + 1)), end: quote + 1 + close.length };
  }
  const at = text.indexOf(close, start);
  if (at < 0) fail(line, `"${close}" never closes the node label. ${FLOW_SUBSET}`);
  return { label: cleanLabel(text.slice(start, at)), end: at + close.length };
};

const readFlowNode = (text: string, start: number, line: number): FlowNodeRef | null => {
  const id = /[A-Za-z0-9_]+/y;
  id.lastIndex = start;
  const match = id.exec(text);
  if (!match) return null;
  const after = start + match[0].length;
  const ref: FlowNodeRef = { id: match[0], end: after };

  if (text.startsWith("(((", after)) {
    fail(line, `the double-circle shape A(((…))) is not supported. ${FLOW_SUBSET}`);
  }
  if (text.startsWith("@{", after)) {
    fail(line, `the A@{ shape: … } syntax is not supported. ${FLOW_SUBSET}`);
  }
  if (text[after] === ">") {
    fail(line, `the asymmetric shape A>…] is not supported. ${FLOW_SUBSET}`);
  }

  // Slanted shapes close with either slash, and which one decides the shape.
  if (text.startsWith("[/", after) || text.startsWith("[\\", after)) {
    const opener = text[after + 1];
    const body = after + 2;
    const slash = text.indexOf("/]", body);
    const back = text.indexOf("\\]", body);
    const closeAt = [slash, back].filter((at) => at >= 0).sort((a, b) => a - b)[0];
    if (closeAt === undefined) fail(line, `"${opener}]" never closes the node label.`);
    const closer = text[closeAt];
    if (opener === "\\" && closer === "/") {
      fail(line, `the inverted trapezoid A[\\…/] is not supported. ${FLOW_SUBSET}`);
    }
    ref.label = cleanLabel(text.slice(body, closeAt));
    ref.shape =
      opener === "/" ? (closer === "/" ? "parallelogram" : "trapezoid") : "parallelogram-alt";
    ref.end = closeAt + 2;
    return ref;
  }

  for (const [open, close, shape] of FLOW_SHAPES) {
    if (!text.startsWith(open, after)) continue;
    const { label, end } = readLabel(text, after + open.length, close, line);
    return { ...ref, label, shape, end };
  }
  return ref;
};

interface FlowLink {
  end: number;
  style: EdgeStyle;
  startCap: EdgeCap;
  endCap: EdgeCap;
  label?: string;
}

/** `-- text -->`, `-. text .->`, `== text ==>`. */
const TEXT_LINK = /(<)?(--|==|-\.)\s*([^\s\-=.>|][^|]*?)\s*(-{2,}|={2,}|\.-+)([>ox])?(?![-=.>])/y;
/** `-->`, `---`, `-.->`, `==>`, `--o`, `<-->` and their longer forms. */
const PLAIN_LINK = /(<)?(-{2,}|={2,}|-\.+-)([>ox])?/y;
const PIPE_LABEL = /\s*\|([^|]*)\|/y;

const readFlowLink = (text: string, start: number, line: number): FlowLink | null => {
  let match: RegExpExecArray | null = null;
  let label: string | undefined;
  let body = "";
  let head: string | undefined;
  let tail: string | undefined;

  TEXT_LINK.lastIndex = start;
  match = TEXT_LINK.exec(text);
  if (match) {
    [, tail, body, label, , head] = match;
    body += match[4];
  } else {
    PLAIN_LINK.lastIndex = start;
    match = PLAIN_LINK.exec(text);
    if (!match) return null;
    [, tail, body, head] = match;
  }

  let end = start + match[0].length;
  if (head === "x") {
    fail(line, `"${match[0].trim()}" cross-ended links cannot be drawn in FigJam. ${FLOW_SUBSET}`);
  }
  if (tail && head !== ">") {
    fail(line, `a link that starts with "<" must end with ">". ${FLOW_SUBSET}`);
  }

  PIPE_LABEL.lastIndex = end;
  const piped = PIPE_LABEL.exec(text);
  if (piped) {
    label = piped[1];
    end += piped[0].length;
  }

  return {
    end,
    style: body.includes(".") ? "dashed" : body.includes("=") ? "thick" : "solid",
    startCap: tail ? "arrow" : "none",
    endCap: head === ">" ? "arrow" : head === "o" ? "circle" : "none",
    label: label !== undefined && cleanLabel(label) !== "" ? cleanLabel(label) : undefined,
  };
};

const registerFlowNode = (ref: FlowNodeRef, builder: Builder): string =>
  ref.shape ? builder.declare(ref.id, ref.label ?? ref.id, ref.shape) : builder.ref(ref.id, "rect");

const parseFlowchart = (statements: Statement[], builder: Builder): void => {
  for (const { text, line } of statements) {
    const keyword = text.match(/^([A-Za-z]+)(?:\s|$)/)?.[1];
    if (keyword && FLOW_KEYWORDS.has(keyword.toLowerCase())) {
      fail(line, `"${keyword}" statements are not supported. ${FLOW_SUBSET}`);
    }

    let at = skipSpace(text, 0);
    let left = readFlowNode(text, at, line);
    if (!left) fail(line, `expected a node id, found "${text}". ${FLOW_SUBSET}`);
    let from = registerFlowNode(left as FlowNodeRef, builder);
    at = skipSpace(text, (left as FlowNodeRef).end);

    while (at < text.length) {
      if (text[at] === "&") {
        fail(
          line,
          `"&" (several nodes on one side of a link) is not supported; write one link per statement.`
        );
      }
      const link = readFlowLink(text, at, line);
      if (!link) {
        fail(line, `expected a link after "${from}", found "${text.slice(at)}". ${FLOW_SUBSET}`);
      }
      const { end, style, startCap, endCap, label } = link as FlowLink;
      at = skipSpace(text, end);
      const right = readFlowNode(text, at, line);
      if (!right) fail(line, `expected a node after the link, found "${text.slice(at)}".`);
      const to = registerFlowNode(right as FlowNodeRef, builder);
      builder.edge(from, to, style, { label, startCap, endCap });
      from = to;
      left = right;
      at = skipSpace(text, (right as FlowNodeRef).end);
    }
  }
};

// ----------------------------------------------------------------- sequence

const SEQUENCE_SUBSET =
  "Supported sequence syntax: participant A [as Label], actor A [as Label], autonumber, and messages A->>B, A-->>B, A->B, A-->B, A-)B, A--)B with an optional : text.";

const SEQUENCE_BLOCKS = new Set([
  "loop",
  "alt",
  "else",
  "opt",
  "par",
  "and",
  "critical",
  "option",
  "break",
  "rect",
  "end",
  "note",
  "activate",
  "deactivate",
  "box",
  "create",
  "destroy",
  "link",
  "links",
  "properties",
  "details",
  "title",
  "acctitle",
  "accdescr",
]);

const MESSAGE_ARROWS: Record<string, { style: EdgeStyle; endCap: EdgeCap }> = {
  "->>": { style: "solid", endCap: "arrow" },
  "-->>": { style: "dashed", endCap: "arrow" },
  "->": { style: "solid", endCap: "none" },
  "-->": { style: "dashed", endCap: "none" },
  "-)": { style: "solid", endCap: "open-arrow" },
  "--)": { style: "dashed", endCap: "open-arrow" },
};

const parseSequence = (statements: Statement[], builder: Builder): void => {
  const PARTICIPANT = /^(participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/i;
  const MESSAGE =
    /^(\w+)\s*(<<-->>|<<->>|-->>|->>|-->|->|--\)|-\)|--x|-x)\s*([+-])?\s*(\w+)\s*(?::(.*))?$/;
  let numbering = false;
  let count = 0;

  for (const { text, line } of statements) {
    const keyword = text.match(/^([A-Za-z]+)(?:\s|$)/)?.[1]?.toLowerCase();
    if (keyword && SEQUENCE_BLOCKS.has(keyword)) {
      fail(line, `"${keyword}" is not supported in sequence diagrams. ${SEQUENCE_SUBSET}`);
    }
    if (text === "autonumber") {
      numbering = true;
      continue;
    }

    const participant = text.match(PARTICIPANT);
    if (participant) {
      const [, , id, alias] = participant;
      builder.declare(id, alias ? cleanLabel(alias) : id, "actor");
      continue;
    }

    const message = text.match(MESSAGE);
    if (!message) fail(line, `could not read "${text}". ${SEQUENCE_SUBSET}`);
    const [, from, arrow, activation, to, rawLabel] = message as RegExpMatchArray;
    if (activation) {
      fail(line, `"${activation}" activation shorthand is not supported. ${SEQUENCE_SUBSET}`);
    }
    const drawn = MESSAGE_ARROWS[arrow];
    if (!drawn) {
      fail(line, `"${arrow}" messages cannot be drawn in FigJam. ${SEQUENCE_SUBSET}`);
    }
    builder.ref(from, "actor");
    builder.ref(to, "actor");
    let label = rawLabel === undefined ? "" : cleanLabel(rawLabel);
    if (numbering) {
      count++;
      label = label === "" ? `${count}.` : `${count}. ${label}`;
    }
    builder.edge(from, to, drawn.style, { label, endCap: drawn.endCap });
  }
};

// ----------------------------------------------------------------------- ER

const ER_SUBSET =
  'Supported ER syntax: ENTITY, ENTITY { type name [PK|FK|UK] ["comment"] }, and relationships A ||--o{ B : label using the |o || }o }| (left) and o| || o{ |{ (right) markers with -- or ..';

const LEFT_CARDINALITY: Record<string, EdgeCap> = {
  "|o": "zero-or-one",
  "||": "exactly-one",
  "}o": "zero-or-more",
  "}|": "one-or-more",
};

const RIGHT_CARDINALITY: Record<string, EdgeCap> = {
  "o|": "zero-or-one",
  "||": "exactly-one",
  "o{": "zero-or-more",
  "|{": "one-or-more",
};

const parseEr = (
  statements: Statement[],
  builder: Builder,
  setDirection: (d: Direction) => void
): void => {
  const NAME = "[A-Za-z_][\\w-]*";
  const ENTITY_OPEN = new RegExp(String.raw`^(${NAME})\s*\{$`);
  const ENTITY = new RegExp(String.raw`^(${NAME})$`);
  const RELATION = new RegExp(String.raw`^(${NAME})\s+(\S+)\s+(${NAME})\s*:\s*(.*)$`);
  const CARDINALITY = /^([|}][o|])(--|\.\.)([o|][|{])$/;
  const ATTRIBUTE =
    /^([\w()[\],-]+)\s+([\w*-]+)((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?)(?:\s+"([^"]*)")?$/;
  const DIRECTION = /^direction\s+(TB|TD|BT|LR|RL)$/i;

  let open: { name: string; line: number; attributes: string[] } | null = null;

  for (const { text, line } of statements) {
    if (open) {
      if (text === "}") {
        builder.declare(open.name, [open.name, ...open.attributes].join("\n"), "entity");
        open = null;
        continue;
      }
      const attribute = text.match(ATTRIBUTE);
      if (!attribute) fail(line, `could not read the attribute "${text}". ${ER_SUBSET}`);
      const [, type, name, keys, comment] = attribute as RegExpMatchArray;
      open.attributes.push(
        `${type} ${name}${keys ? ` ${keys.trim()}` : ""}${comment ? ` "${comment}"` : ""}`
      );
      continue;
    }

    const direction = text.match(DIRECTION);
    if (direction) {
      setDirection(readDirection(direction[1]));
      continue;
    }

    const opening = text.match(ENTITY_OPEN);
    if (opening) {
      open = { name: opening[1], line, attributes: [] };
      continue;
    }

    const entity = text.match(ENTITY);
    if (entity) {
      builder.ref(entity[1], "entity");
      continue;
    }

    const relation = text.match(RELATION);
    if (!relation) fail(line, `could not read "${text}". ${ER_SUBSET}`);
    const [, left, marker, right, rawLabel] = relation as RegExpMatchArray;
    const cardinality = marker.match(CARDINALITY);
    if (!cardinality)
      fail(line, `"${marker}" is not a relationship marker this relay reads. ${ER_SUBSET}`);
    const [, leftEnd, stroke, rightEnd] = cardinality as RegExpMatchArray;
    builder.ref(left, "entity");
    builder.ref(right, "entity");
    const label = cleanLabel(rawLabel);
    builder.edge(left, right, stroke === ".." ? "dashed" : "solid", {
      label: label === "" ? undefined : label,
      startCap: LEFT_CARDINALITY[leftEnd],
      endCap: RIGHT_CARDINALITY[rightEnd],
    });
  }

  if (open) fail(open.line, `the attribute block for ${open.name} is never closed with "}".`);
};

// -------------------------------------------------------------------- state

const STATE_SUBSET =
  'Supported state syntax: [*] --> A, A --> B [: label], state "Description" as A, A : description, state A <<choice>>, direction LR.';

const parseState = (
  statements: Statement[],
  builder: Builder,
  setDirection: (d: Direction) => void
): void => {
  const NAME = "[A-Za-z_][\\w-]*";
  const TRANSITION = new RegExp(
    String.raw`^(\[\*\]|${NAME})\s*-->\s*(\[\*\]|${NAME})\s*(?::(.*))?$`
  );
  const STATE_AS = new RegExp(String.raw`^state\s+"([^"]*)"\s+as\s+(${NAME})$`);
  const STEREOTYPE = new RegExp(String.raw`^state\s+(${NAME})\s+<<(\w+)>>$`);
  const DESCRIPTION = new RegExp(String.raw`^(${NAME})\s*:\s*(.+)$`);
  const BARE = new RegExp(String.raw`^(${NAME})$`);
  const DIRECTION = /^direction\s+(TB|TD|BT|LR|RL)$/i;

  const endpoint = (token: string, side: "start" | "end"): string => {
    if (token !== "[*]") return builder.ref(token, "state");
    return side === "start" ? builder.ref("__start", "start", "") : builder.ref("__end", "end", "");
  };

  for (const { text, line } of statements) {
    if (/^state\b.*\{$/.test(text) || text === "}") {
      fail(line, `composite states ({ … }) are not supported. ${STATE_SUBSET}`);
    }
    if (/^note\b/i.test(text)) fail(line, `notes are not supported. ${STATE_SUBSET}`);
    if (text === "--") fail(line, `concurrent regions (--) are not supported. ${STATE_SUBSET}`);

    const direction = text.match(DIRECTION);
    if (direction) {
      setDirection(readDirection(direction[1]));
      continue;
    }

    const transition = text.match(TRANSITION);
    if (transition) {
      const [, left, right, rawLabel] = transition;
      const from = endpoint(left, "start");
      const to = endpoint(right, "end");
      const label = rawLabel === undefined ? "" : cleanLabel(rawLabel);
      builder.edge(from, to, "solid", { label: label === "" ? undefined : label });
      continue;
    }

    const described = text.match(STATE_AS);
    if (described) {
      builder.declare(described[2], cleanLabel(described[1]), "state");
      continue;
    }

    const stereotype = text.match(STEREOTYPE);
    if (stereotype) {
      const [, id, kind] = stereotype;
      if (kind.toLowerCase() !== "choice") {
        fail(line, `<<${kind}>> states are not supported. ${STATE_SUBSET}`);
      }
      builder.declare(id, id, "diamond");
      continue;
    }

    const description = text.match(DESCRIPTION);
    if (description) {
      const [, id, rawText] = description;
      const existing = builder.get(id);
      const addition = cleanLabel(rawText);
      // Mermaid stacks repeated descriptions; the first replaces the bare id.
      const label =
        existing && existing.label !== existing.id ? `${existing.label}\n${addition}` : addition;
      builder.declare(id, label, existing?.shape ?? "state");
      continue;
    }

    const bare = text.match(BARE);
    if (bare) {
      builder.ref(bare[1], "state");
      continue;
    }

    fail(line, `could not read "${text}". ${STATE_SUBSET}`);
  }
};

// --------------------------------------------------------------------- entry

/**
 * Parses Mermaid source into the renderer's intermediate representation.
 * @param source - Mermaid text.
 * @throws When the diagram type is unsupported or unrecognisable, when any
 * statement falls outside the subset, or when the diagram is empty or too large.
 */
export const parseMermaid = (source: string): Diagram => {
  const firstLine = source.split(/\r?\n/).find((line) => line.trim() !== "");
  if (firstLine?.trim() === "---") {
    throw new Error(
      "Front matter (a --- block before the diagram) is not supported. Remove it and start with the diagram type."
    );
  }

  const statements = statementsOf(source);
  if (statements.length === 0) {
    throw new Error(`Empty diagram. Supported types: ${SUPPORTED_DIAGRAMS}.`);
  }

  const [header, ...body] = statements;
  const [word, ...rest] = header.text.split(/\s+/);
  const kind = HEADERS[word.toLowerCase()];
  if (!kind) {
    throw new Error(
      KNOWN_UNSUPPORTED.has(word.toLowerCase())
        ? `Unsupported diagram type "${word}". Supported types: ${SUPPORTED_DIAGRAMS}.`
        : `Could not determine the diagram type from "${header.text}". Start with one of: ${SUPPORTED_DIAGRAMS}.`
    );
  }

  let direction: Direction = "TD";
  if (kind === "flowchart" && rest.length > 0) {
    if (rest.length > 1 || !/^(TB|TD|BT|LR|RL)$/i.test(rest[0])) {
      fail(
        header.line,
        `expected "${word}" followed by an optional direction (TD, TB, BT, LR or RL).`
      );
    }
    direction = readDirection(rest[0]);
  } else if (kind !== "flowchart" && rest.length > 0) {
    fail(header.line, `"${word}" takes nothing after it on the first line.`);
  }

  const builder = new Builder();
  const setDirection = (value: Direction) => {
    direction = value;
  };

  if (kind === "flowchart") parseFlowchart(body, builder);
  else if (kind === "sequence") parseSequence(body, builder);
  else if (kind === "er") parseEr(body, builder, setDirection);
  else parseState(body, builder, setDirection);

  const nodes = builder.list();
  if (nodes.length === 0) {
    throw new Error(
      `The ${kind} diagram declared no nodes. Check the syntax against the supported subset: ${SUPPORTED_DIAGRAMS}.`
    );
  }
  if (nodes.length > MAX_NODES || builder.edges.length > MAX_EDGES) {
    throw new Error(
      `The diagram is too large to draw in one call: ${nodes.length} nodes and ${builder.edges.length} edges, against limits of ${MAX_NODES} and ${MAX_EDGES}. Split it into several diagrams.`
    );
  }

  return { kind, direction, nodes, edges: builder.edges };
};
