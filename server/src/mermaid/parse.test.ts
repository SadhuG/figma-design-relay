import { describe, expect, test } from "bun:test";
import { parseMermaid } from "./parse.js";

describe("flowchart", () => {
  const diagram = parseMermaid(`
flowchart TD
  A[Start] --> B{Ready?}
  B -->|yes| C(Ship)
  B -->|no| A
`);

  test("reads the kind and direction", () => {
    expect(diagram.kind).toBe("flowchart");
    expect(diagram.direction).toBe("TD");
  });

  test("reads nodes with their labels and shapes", () => {
    expect(diagram.nodes).toContainEqual({ id: "A", label: "Start", shape: "rect" });
    expect(diagram.nodes).toContainEqual({ id: "B", label: "Ready?", shape: "diamond" });
    expect(diagram.nodes).toContainEqual({ id: "C", label: "Ship", shape: "round" });
  });

  test("reads edges and their labels", () => {
    expect(diagram.edges).toContainEqual({ from: "B", to: "C", label: "yes", style: "solid" });
    expect(diagram.edges).toHaveLength(3);
  });

  test("declares each node once even when it appears twice", () => {
    expect(diagram.nodes.filter((node) => node.id === "A")).toHaveLength(1);
  });
});

describe("flowchart syntax", () => {
  const edgesOf = (body: string) => parseMermaid(`flowchart LR\n${body}`).edges;
  const nodeOf = (body: string) => parseMermaid(`flowchart LR\n${body}`).nodes[0];

  test("reads a chain as one edge per link", () => {
    expect(edgesOf("A --> B --> C").map((edge) => [edge.from, edge.to])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
  });

  test("reads a label written inside the link", () => {
    expect(edgesOf("A -- yes --> B")[0].label).toBe("yes");
    expect(edgesOf("A -. maybe .-> B")[0]).toMatchObject({ label: "maybe", style: "dashed" });
  });

  test("keeps what each link looks like", () => {
    expect(edgesOf("A --- B")[0].endCap).toBe("none");
    expect(edgesOf("A -.-> B")[0].style).toBe("dashed");
    expect(edgesOf("A ==> B")[0].style).toBe("thick");
    expect(edgesOf("A --o B")[0].endCap).toBe("circle");
    expect(edgesOf("A <--> B")[0]).toMatchObject({ startCap: "arrow" });
    expect(edgesOf("A ----> B")[0].endCap).toBeUndefined();
  });

  test("reads every shape FigJam can draw", () => {
    expect(nodeOf("A((Hub))")).toEqual({ id: "A", label: "Hub", shape: "circle" });
    expect(nodeOf("A[(Orders)]").shape).toBe("cylinder");
    expect(nodeOf("A{{Prep}}").shape).toBe("hexagon");
    expect(nodeOf("A[[Call]]").shape).toBe("subroutine");
    expect(nodeOf("A([Go])").shape).toBe("stadium");
    expect(nodeOf("A[/Input/]").shape).toBe("parallelogram");
    expect(nodeOf("A[\\Output\\]").shape).toBe("parallelogram-alt");
    expect(nodeOf("A[/Manual\\]").shape).toBe("trapezoid");
  });

  test("reads a quoted label, brackets and all", () => {
    expect(nodeOf('A["Say (hi) [now]"]').label).toBe("Say (hi) [now]");
  });

  test("turns <br> into a line break", () => {
    expect(nodeOf("A[One<br/>Two]").label).toBe("One\nTwo");
  });

  test("splits statements on semicolons", () => {
    expect(edgesOf("A --> B; B --> C;")).toHaveLength(2);
  });

  test("a later explicit declaration replaces a bare reference", () => {
    const nodes = parseMermaid("flowchart TD\n A --> B\n B[Build]").nodes;
    expect(nodes.find((node) => node.id === "B")).toEqual({
      id: "B",
      label: "Build",
      shape: "rect",
    });
  });

  test("keeps the reversed directions", () => {
    expect(parseMermaid("flowchart BT\n A --> B").direction).toBe("BT");
    expect(parseMermaid("graph RL\n A --> B").direction).toBe("RL");
    expect(parseMermaid("flowchart TB\n A --> B").direction).toBe("TD");
    expect(parseMermaid("flowchart\n A --> B").direction).toBe("TD");
  });
});

describe("sequenceDiagram", () => {
  const diagram = parseMermaid(`
sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: GET /items
  S-->>U: 200 OK
`);

  test("reads participants with their aliases", () => {
    expect(diagram.nodes).toEqual([
      { id: "U", label: "User", shape: "actor" },
      { id: "S", label: "Server", shape: "actor" },
    ]);
  });

  test("reads messages, keeping dashed replies distinct", () => {
    expect(diagram.edges[0]).toEqual({ from: "U", to: "S", label: "GET /items", style: "solid" });
    expect(diagram.edges[1].style).toBe("dashed");
  });

  test("keeps the arrowhead each message was written with", () => {
    const edges = parseMermaid("sequenceDiagram\n A->B: plain\n A-)B: async").edges;
    expect(edges[0].endCap).toBe("none");
    expect(edges[1].endCap).toBe("open-arrow");
  });

  test("numbers messages under autonumber", () => {
    const edges = parseMermaid("sequenceDiagram\n autonumber\n A->>B: one\n B->>A: two").edges;
    expect(edges.map((edge) => edge.label)).toEqual(["1. one", "2. two"]);
  });

  test("keeps a message a participant sends itself", () => {
    const edges = parseMermaid("sequenceDiagram\n A->>A: validate").edges;
    expect(edges[0]).toMatchObject({ from: "A", to: "A", label: "validate" });
  });
});

describe("erDiagram", () => {
  const diagram = parseMermaid(`
erDiagram
  CUSTOMER ||--o{ ORDER : places
`);

  test("reads entities and the relationship label", () => {
    expect(diagram.nodes.map((node) => node.id)).toEqual(["CUSTOMER", "ORDER"]);
    expect(diagram.edges[0]).toEqual({
      from: "CUSTOMER",
      to: "ORDER",
      label: "places",
      style: "solid",
      startCap: "exactly-one",
      endCap: "zero-or-more",
    });
  });

  test("reads a non-identifying relationship as dashed", () => {
    const edge = parseMermaid("erDiagram\n A |o..|{ B : has").edges[0];
    expect(edge).toMatchObject({ style: "dashed", startCap: "zero-or-one", endCap: "one-or-more" });
  });

  test("lists an entity's attributes under its name", () => {
    const nodes = parseMermaid(`erDiagram
  CUSTOMER {
    string name PK
    int age
  }`).nodes;
    expect(nodes[0]).toEqual({
      id: "CUSTOMER",
      label: "CUSTOMER\nstring name PK\nint age",
      shape: "entity",
    });
  });
});

describe("stateDiagram", () => {
  const diagram = parseMermaid(`
stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> [*]
`);

  test("turns the start and end markers into distinct nodes", () => {
    const shapes = diagram.nodes.map((node) => node.shape);
    expect(shapes).toContain("start");
    expect(shapes).toContain("end");
  });

  test("reads the transition label", () => {
    expect(diagram.edges.find((edge) => edge.from === "Idle")?.label).toBe("start");
  });

  test("uses one start and one end however often [*] appears", () => {
    const many = parseMermaid(
      "stateDiagram-v2\n [*] --> A\n [*] --> B\n A --> [*]\n B --> [*]"
    ).nodes;
    expect(many.filter((node) => node.shape === "start")).toHaveLength(1);
    expect(many.filter((node) => node.shape === "end")).toHaveLength(1);
  });

  test("reads a state's description", () => {
    const nodes = parseMermaid(
      'stateDiagram-v2\n state "Waiting for input" as W\n [*] --> W\n R : Running now\n W --> R'
    ).nodes;
    expect(nodes.find((node) => node.id === "W")?.label).toBe("Waiting for input");
    expect(nodes.find((node) => node.id === "R")?.label).toBe("Running now");
  });

  test("draws a choice state as a diamond", () => {
    const nodes = parseMermaid("stateDiagram-v2\n state check <<choice>>\n A --> check").nodes;
    expect(nodes.find((node) => node.id === "check")?.shape).toBe("diamond");
  });

  test("reads a direction statement", () => {
    expect(parseMermaid("stateDiagram-v2\n direction LR\n A --> B").direction).toBe("LR");
  });
});

describe("refusals", () => {
  test("names the unsupported diagram type and lists the supported ones", () => {
    expect(() => parseMermaid('pie title Votes\n  "a" : 10')).toThrow(/pie/);
    expect(() => parseMermaid("pie title Votes")).toThrow(/flowchart/);
  });

  test("refuses input with no recognisable header", () => {
    expect(() => parseMermaid("just some text")).toThrow(/could not determine/i);
  });

  test("refuses an empty diagram rather than rendering nothing", () => {
    expect(() => parseMermaid("flowchart TD")).toThrow(/no nodes/i);
  });

  test("ignores comments", () => {
    const diagram = parseMermaid("flowchart LR\n  %% a comment\n  A --> B");
    expect(diagram.nodes).toHaveLength(2);
    expect(diagram.direction).toBe("LR");
  });

  // Silently skipping a statement would draw a diagram that looks complete and
  // is not — the one outcome worse than an error.
  test("refuses a statement outside the subset, naming its line", () => {
    expect(() => parseMermaid("flowchart TD\n A --> B\n subgraph one\n C\n end")).toThrow(
      /line 3.*subgraph/i
    );
  });

  test("refuses flowchart syntax FigJam cannot draw", () => {
    expect(() => parseMermaid("flowchart TD\n A --x B")).toThrow(/--x/);
    expect(() => parseMermaid("flowchart TD\n A & B --> C")).toThrow(/&/);
    expect(() => parseMermaid("flowchart TD\n A>Flag]")).toThrow(/line 2/i);
    expect(() => parseMermaid("flowchart TD\n A --> B\n click A callback")).toThrow(/click/);
  });

  test("refuses sequence blocks and notes by name", () => {
    expect(() => parseMermaid("sequenceDiagram\n loop Every minute\n A->>B: ping\n end")).toThrow(
      /loop/
    );
    expect(() => parseMermaid("sequenceDiagram\n A->>B: hi\n Note over A: x")).toThrow(/note/i);
    expect(() => parseMermaid("sequenceDiagram\n A->>+B: hi")).toThrow(/activation/i);
    expect(() => parseMermaid("sequenceDiagram\n A-xB: lost")).toThrow(/-x/);
  });

  test("refuses a composite state", () => {
    expect(() => parseMermaid("stateDiagram-v2\n state Busy {\n A --> B\n }")).toThrow(
      /composite/i
    );
  });

  test("refuses an ER relationship it cannot read", () => {
    expect(() => parseMermaid("erDiagram\n A one to many B : has")).toThrow(/line 2/i);
  });

  test("refuses front matter", () => {
    expect(() => parseMermaid("---\ntitle: Flow\n---\nflowchart TD\n A --> B")).toThrow(
      /front matter/i
    );
  });

  test("refuses a diagram too large to draw in one call", () => {
    const edges = Array.from({ length: 250 }, (_, index) => `N${index} --> N${index + 1}`);
    expect(() => parseMermaid(`flowchart TD\n${edges.join("\n")}`)).toThrow(/too large/i);
  });
});
