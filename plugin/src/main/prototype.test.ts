import { describe, expect, test } from "bun:test";
import {
  getPrototypeConnections,
  scanPrototype,
  tracePrototypeFlow,
  type PrototypeContext,
} from "./prototype";

/**
 * Fake scene graph. Pages behave like `documentAccess: "dynamic-page"`: reading
 * `children` before `loadAsync()` throws, exactly as Figma does.
 */
interface FakeNode {
  id: string;
  name: string;
  type: string;
  parent: FakeNode | null;
  children?: FakeNode[];
  reactions?: unknown[];
  [key: string]: unknown;
}

const doc: FakeNode = { id: "0:0", name: "Document", type: "DOCUMENT", parent: null };

const makePage = (id: string, name: string, loaded: boolean) => {
  const kids: FakeNode[] = [];
  const page: any = {
    id,
    name,
    type: "PAGE",
    parent: doc,
    loaded,
    loads: 0,
    flowStartingPoints: [{ nodeId: "1:1", name: "Start" }],
    get children() {
      if (!page.loaded) throw new Error("Cannot access children before loadAsync");
      return kids;
    },
    async loadAsync() {
      page.loads += 1;
      page.loaded = true;
    },
    kids,
  };
  return page;
};

const add = (parent: any, node: Omit<FakeNode, "parent">): FakeNode => {
  const child = { ...node, parent } as FakeNode;
  if (parent.kids) parent.kids.push(child);
  else (parent.children ??= []).push(child);
  return child;
};

const navigate = (destinationId: string | null, navigation = "NAVIGATE") => ({
  type: "NODE",
  destinationId,
  navigation,
  transition: null,
});

const onClick = (...actions: unknown[]) => ({ trigger: { type: "ON_CLICK" }, actions });

const contextFor = (
  nodes: FakeNode[],
  extra: Partial<PrototypeContext> = {}
): PrototypeContext & { lookups: string[] } => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lookups: string[] = [];
  return {
    lookups,
    fileName: "Proto file",
    fileKey: "abc",
    getNodeByIdAsync: async (id) => {
      lookups.push(id);
      return (byId.get(id) ?? null) as unknown as BaseNode | null;
    },
    getVariableByIdAsync: async () => null,
    getVariableCollectionByIdAsync: async () => null,
    ...extra,
  };
};

/** A on page 1 → B on page 1 → A, plus C inside a section. */
const buildLoop = () => {
  const page = makePage("1:0", "Page 1", true);
  const a = add(page, { id: "1:1", name: "A", type: "FRAME", reactions: [], children: [] });
  const button = add(a, {
    id: "1:2",
    name: "Button",
    type: "INSTANCE",
    reactions: [onClick(navigate("1:3"))],
  });
  const b = add(page, { id: "1:3", name: "B", type: "FRAME", reactions: [], children: [] });
  const sub = add(b, {
    id: "I1:4;5:6",
    name: "Back link",
    type: "TEXT",
    reactions: [onClick(navigate("1:1"))],
  });
  const section = add(page, { id: "1:7", name: "Flows", type: "SECTION", children: [] });
  const c = add(section, { id: "1:8", name: "C", type: "FRAME", reactions: [], children: [] });
  return { page, a, button, b, sub, section, c };
};

describe("tracePrototypeFlow", () => {
  test("A -> B -> A expands each screen once and records one revisit", async () => {
    const f = buildLoop();
    const ctx = contextFor([f.a, f.button, f.b, f.sub, f.c]);
    const trace = await tracePrototypeFlow(f.a as any, undefined, ctx);
    expect(trace.screens.map((s) => s.name)).toEqual(["A", "B"]);
    expect(trace.screens.map((s) => s.depth)).toEqual([0, 1]);
    expect(trace.screens[1].reachedVia).toBe("1:2");
    expect(trace.edges.filter((e) => e.revisit).length).toBe(1);
    expect(trace.edges.map((e) => e.toScreen?.name)).toEqual(["B", "A"]);
    expect(trace.edges[1].source).toMatchObject({ id: "I1:4;5:6", instanceSublayer: true });
    expect(trace).toMatchObject({ schemaVersion: 1, fileKey: "abc", fileName: "Proto file" });
    expect(trace.truncated).toBe(false);
  });

  test("conditional branches keep their path and conditions; non-screen actions add no screens", async () => {
    const page = makePage("1:0", "Page 1", true);
    const a = add(page, { id: "1:1", name: "A", type: "FRAME", reactions: [], children: [] });
    const target = add(page, { id: "1:9", name: "Target", type: "FRAME", reactions: [] });
    const cond = { type: "EXPRESSION" };
    const node = add(a, {
      id: "1:2",
      name: "Btn",
      type: "FRAME",
      reactions: [
        onClick(
          { type: "URL", url: "https://example.com" },
          {
            type: "CONDITIONAL",
            conditionalBlocks: [
              { condition: cond, actions: [navigate("1:9")] },
              { actions: [{ type: "BACK" }, { type: "CLOSE" }, navigate("1:9", "SCROLL_TO")] },
            ],
          },
          { type: "SET_VARIABLE", variableId: "V:1", variableValue: { type: "BOOLEAN" } },
          { type: "UPDATE_MEDIA_RUNTIME", destinationId: null, mediaAction: "PLAY" },
          navigate("1:9", "CHANGE_TO")
        ),
      ],
    });
    const trace = await tracePrototypeFlow(a as any, undefined, contextFor([a, node, target]));
    expect(trace.edges.map((e) => [e.actionPath, e.kind])).toEqual([
      ["reactions[0].actions[0]", "url"],
      ["reactions[0].actions[1].conditionalBlocks[0].actions[0]", "screen"],
      ["reactions[0].actions[1].conditionalBlocks[1].actions[0]", "back"],
      ["reactions[0].actions[1].conditionalBlocks[1].actions[1]", "close"],
      ["reactions[0].actions[1].conditionalBlocks[1].actions[2]", "in-screen"],
      ["reactions[0].actions[2]", "variable"],
      ["reactions[0].actions[3]", "media"],
      ["reactions[0].actions[4]", "in-screen"],
    ]);
    expect(trace.edges[1].conditions).toEqual([cond]);
    expect(trace.edges[2].conditions).toEqual([null]);
    expect(trace.screens.map((s) => s.name)).toEqual(["A", "Target"]);
  });

  test("maxScreens 1 lists the discovered targets as pending", async () => {
    const f = buildLoop();
    const trace = await tracePrototypeFlow(
      f.a as any,
      { maxScreens: 1 },
      contextFor([f.a, f.button, f.b, f.sub])
    );
    expect(trace.screens.map((s) => s.name)).toEqual(["A"]);
    expect(trace.truncated).toBe(true);
    expect(trace.pending.map((s) => s.name)).toEqual(["B"]);
  });

  test("a cross-page target on an unloaded page is loaded before it is expanded", async () => {
    const page1 = makePage("1:0", "Page 1", true);
    const page2 = makePage("2:0", "Page 2", false);
    const a = add(page1, { id: "1:1", name: "A", type: "FRAME", reactions: [], children: [] });
    const btn = add(a, {
      id: "1:2",
      name: "Go",
      type: "FRAME",
      reactions: [onClick(navigate("2:1"))],
    });
    const far = add(page2, { id: "2:1", name: "Far", type: "FRAME", reactions: [], children: [] });
    const back = add(far, {
      id: "2:2",
      name: "Back",
      type: "FRAME",
      reactions: [onClick(navigate("1:1"))],
    });
    const trace = await tracePrototypeFlow(a as any, undefined, contextFor([a, btn, far, back]));
    expect(page2.loads).toBe(1);
    expect(trace.screens.map((s) => s.name)).toEqual(["A", "Far"]);
    expect(trace.edges[0].action).toMatchObject({
      destination: { status: "resolved", page: { id: "2:0", name: "Page 2" } },
    });
    expect(trace.edges[1]).toMatchObject({ toScreen: { id: "1:1" }, revisit: true });
  });

  test("a missing or unreadable destination is unresolved without losing other edges", async () => {
    const page = makePage("1:0", "Page 1", true);
    const a = add(page, { id: "1:1", name: "A", type: "FRAME", reactions: [], children: [] });
    const b = add(page, { id: "1:3", name: "B", type: "FRAME", reactions: [] });
    const btn = add(a, {
      id: "1:2",
      name: "Btn",
      type: "FRAME",
      reactions: [onClick(navigate("9:9"), navigate("8:8"), navigate("1:3"))],
    });
    const base = contextFor([a, b, btn]);
    const ctx = contextFor([a, b, btn], {
      getNodeByIdAsync: async (id) => {
        if (id === "8:8") throw new Error("network");
        return base.getNodeByIdAsync(id);
      },
    });
    const trace = await tracePrototypeFlow(a as any, undefined, ctx);
    expect(trace.edges.map((e) => (e.action as any).destination.status)).toEqual([
      "missing",
      "error",
      "resolved",
    ]);
    expect(trace.unresolved).toEqual([
      { edgeIndex: 0, destinationId: "9:9" },
      { edgeIndex: 1, destinationId: "8:8" },
    ]);
    expect(trace.screens.map((s) => s.name)).toEqual(["A", "B"]);
  });

  test("a page is not a valid start", async () => {
    const page = makePage("1:0", "Page 1", true);
    await expect(tracePrototypeFlow(page as any, undefined, contextFor([]))).rejects.toThrow(
      /screen/
    );
  });

  test("a section is not a valid start; a screen inside one is", async () => {
    const f = buildLoop();
    f.c.reactions = [onClick(navigate("1:1"))];
    const ctx = contextFor([f.a, f.c]);
    await expect(tracePrototypeFlow(f.section as any, undefined, ctx)).rejects.toThrow(
      /not a section\. Pass one of its screens/
    );
    const trace = await tracePrototypeFlow(f.c as any, { maxScreens: 1 }, ctx);
    expect(trace.start.name).toBe("C");
    expect(trace.edges[0].fromScreen.name).toBe("C");
  });

  test("a wide screen reads its children once, and maxNodesPerScreen stops the scan", async () => {
    const page = makePage("1:0", "Page 1", true);
    const { node: wide, reads } = wideNode("1:1", "FRAME", page, 2000);
    page.kids.push(wide);
    const trace = await tracePrototypeFlow(wide, { maxNodesPerScreen: 1 }, contextFor([]));
    expect(reads()).toBe(1);
    expect(trace.truncated).toBe(true);
    expect(trace.screens.map((s) => s.name)).toEqual(["Wide"]);
  });
});

/**
 * A container whose `children` getter returns a fresh array on every read,
 * as Figma's does, counting the reads.
 */
const wideNode = (id: string, type: string, parent: any, count: number) => {
  let reads = 0;
  const node: any = { id, name: "Wide", type, parent, reactions: [] };
  const kids = Array.from({ length: count }, (_, i) => ({
    id: `${id}-${i}`,
    name: `Child ${i}`,
    type: "RECTANGLE",
    parent: node,
    reactions: i === count - 1 ? [onClick({ type: "URL", url: "https://example.com" })] : [],
  }));
  Object.defineProperty(node, "children", {
    get() {
      reads += 1;
      return kids.slice();
    },
  });
  return { node, reads: () => reads };
};

describe("scanPrototype and getPrototypeConnections", () => {
  test("overlay settings, variables, modes, flow starts and deprecated single actions survive", async () => {
    const page = makePage("1:0", "Page 1", true);
    const screen = add(page, { id: "1:1", name: "Home", type: "FRAME", children: [] });
    const overlay = add(page, {
      id: "1:5",
      name: "Sheet",
      type: "FRAME",
      overlayPositionType: "BOTTOM_CENTER",
      overlayBackground: { type: "NONE" },
      overlayBackgroundInteraction: "CLOSE_ON_CLICK_OUTSIDE",
    });
    const btn = add(screen, {
      id: "1:2",
      name: "Open",
      type: "FRAME",
      reactions: [
        onClick(navigate("1:5", "OVERLAY")),
        { trigger: { type: "ON_HOVER" }, action: { type: "BACK" } },
        onClick(
          { type: "SET_VARIABLE", variableId: "V:1", variableValue: null },
          { type: "SET_VARIABLE_MODE", variableCollectionId: "C:1", variableModeId: "m2" }
        ),
      ],
    });
    const ctx = contextFor([screen, overlay, btn], {
      getVariableByIdAsync: async () =>
        ({ id: "V:1", name: "isOpen", resolvedType: "BOOLEAN" }) as unknown as Variable,
      getVariableCollectionByIdAsync: async () =>
        ({
          id: "C:1",
          name: "Theme",
          modes: [
            { modeId: "m1", name: "Light" },
            { modeId: "m2", name: "Dark" },
          ],
        }) as unknown as VariableCollection,
    });
    const result = await getPrototypeConnections(screen as any, undefined, ctx);
    expect(result.page).toEqual({ id: "1:0", name: "Page 1", type: "PAGE" });
    expect(result.flowStartingPoints).toEqual([{ nodeId: "1:1", name: "Start" }]);
    const reactions = result.connections[0].reactions;
    expect(reactions[0].actions[0]).toMatchObject({
      destination: {
        status: "resolved",
        name: "Sheet",
        overlay: { overlayPositionType: "BOTTOM_CENTER" },
      },
    });
    expect(reactions[1]).toEqual({ trigger: { type: "ON_HOVER" }, actions: [{ type: "BACK" }] });
    expect(reactions[2].actions[0]).toMatchObject({
      variableId: "V:1",
      variable: { id: "V:1", name: "isOpen", resolvedType: "BOOLEAN" },
    });
    expect(reactions[2].actions[1]).toMatchObject({ collectionName: "Theme", modeName: "Dark" });
  });

  test("unreadable variables and collections become null metadata, keeping their ids", async () => {
    const page = makePage("1:0", "Page 1", true);
    const screen = add(page, { id: "1:1", name: "Home", type: "FRAME", children: [] });
    const btn = add(screen, {
      id: "1:2",
      name: "Toggle",
      type: "FRAME",
      reactions: [
        onClick(
          { type: "SET_VARIABLE", variableId: "V:1", variableValue: null },
          { type: "SET_VARIABLE_MODE", variableCollectionId: "C:1", variableModeId: "m2" }
        ),
      ],
    });
    const ctx = contextFor([screen, btn], {
      getVariableByIdAsync: async () => {
        throw new Error("no access");
      },
      getVariableCollectionByIdAsync: async () => {
        throw new Error("no access");
      },
    });
    const result = await scanPrototype(screen as any, undefined, ctx);
    expect(result.connections[0].reactions[0].actions).toEqual([
      { type: "SET_VARIABLE", variableId: "V:1", variableValue: null, variable: null },
      {
        type: "SET_VARIABLE_MODE",
        variableCollectionId: "C:1",
        variableModeId: "m2",
        collectionName: null,
        modeName: null,
      },
    ]);
  });

  for (const failure of ["synchronously", "asynchronously"]) {
    test(`a lookup that throws ${failure} marks only its reference; a URL action survives`, async () => {
      const page = makePage("1:0", "Page 1", true);
      const screen = add(page, { id: "1:1", name: "Home", type: "FRAME", children: [] });
      const btn = add(screen, {
        id: "1:2",
        name: "Btn",
        type: "FRAME",
        reactions: [
          onClick(
            navigate("9:9"),
            { type: "SET_VARIABLE", variableId: "V:1", variableValue: null },
            { type: "SET_VARIABLE_MODE", variableCollectionId: "C:1", variableModeId: "m2" },
            { type: "URL", url: "https://example.com" }
          ),
        ],
      });
      const fail = (what: string): any =>
        failure === "synchronously"
          ? () => {
              throw new Error(`${what} broke`);
            }
          : async () => {
              throw new Error(`${what} broke`);
            };
      const ctx = contextFor([screen, btn], {
        getNodeByIdAsync: fail("node"),
        getVariableByIdAsync: fail("variable"),
        getVariableCollectionByIdAsync: fail("collection"),
      });
      const result = await scanPrototype(screen as any, undefined, ctx);
      const [nav, variable, mode, url] = result.connections[0].reactions[0].actions as any[];
      expect(nav.destination).toEqual({ status: "error", id: "9:9", error: "node broke" });
      expect(variable.variable).toBeNull();
      expect([mode.collectionName, mode.modeName]).toEqual([null, null]);
      expect(url).toEqual({ type: "URL", url: "https://example.com" });
    });
  }

  test("a wide page reads its children once, however small maxNodes is", async () => {
    const { node: wide, reads } = wideNode("1:1", "PAGE", null, 2000);
    wide.loadAsync = async () => {};
    const tiny = await scanPrototype(wide, { maxNodes: 1 }, contextFor([]));
    expect([tiny.nodesScanned, tiny.truncated, reads()]).toEqual([1, true, 1]);
    const all = await scanPrototype(wide, undefined, contextFor([]));
    expect([all.nodesScanned, all.truncated, reads()]).toEqual([2001, false, 2]);
    expect(all.connections.map((c) => c.name)).toEqual(["Child 1999"]);
  });

  test("a budget that ends inside a subtree keeps layer order and reports truncation", async () => {
    const page = makePage("1:0", "Page 1", true);
    const s = add(page, { id: "1:1", name: "S", type: "FRAME", reactions: [], children: [] });
    const a = add(s, { id: "1:2", name: "A", type: "FRAME", reactions: [], children: [] });
    add(a, { id: "1:3", name: "A1", type: "FRAME", reactions: [] });
    add(a, { id: "1:4", name: "A2", type: "FRAME", reactions: [] });
    add(s, { id: "1:5", name: "B", type: "FRAME", reactions: [] });
    const names = async (maxNodes: number) => {
      const r = await scanPrototype(s as any, { maxNodes, includeEmpty: true }, contextFor([]));
      return [r.connections.map((c) => c.name).join(","), r.truncated];
    };
    expect(await names(3)).toEqual(["S,A,A1", true]);
    expect(await names(4)).toEqual(["S,A,A1,A2", true]);
    expect(await names(5)).toEqual(["S,A,A1,A2,B", false]);
  });

  test("a destination referenced twice is looked up once per request", async () => {
    const f = buildLoop();
    f.button.reactions = [onClick(navigate("1:3")), onClick(navigate("1:3"))];
    const ctx = contextFor([f.a, f.button, f.b]);
    await scanPrototype(f.a as any, undefined, ctx);
    expect(ctx.lookups.filter((id) => id === "1:3").length).toBe(1);
  });

  test("maxNodes 1 scans exactly one node and reports the rest as truncated", async () => {
    const f = buildLoop();
    const result = await scanPrototype(f.a as any, { maxNodes: 1 }, contextFor([]));
    expect(result.nodesScanned).toBe(1);
    expect(result.truncated).toBe(true);
  });

  test("exactly exhausting maxNodes is not truncation", async () => {
    const f = buildLoop();
    const result = await scanPrototype(f.a as any, { maxNodes: 2 }, contextFor([f.b]));
    expect(result.nodesScanned).toBe(2);
    expect(result.truncated).toBe(false);
  });

  test("includeEmpty lists nodes that support reactions but have none", async () => {
    const f = buildLoop();
    const without = await scanPrototype(f.a as any, undefined, contextFor([f.b]));
    const withEmpty = await scanPrototype(f.a as any, { includeEmpty: true }, contextFor([f.b]));
    expect(without.connections.map((c) => c.name)).toEqual(["Button"]);
    expect(withEmpty.connections.map((c) => c.name)).toEqual(["A", "Button"]);
  });

  test("an unloaded page root is loaded before its children are read", async () => {
    const page = makePage("2:0", "Page 2", false);
    add(page, { id: "2:1", name: "Far", type: "FRAME", reactions: [onClick({ type: "BACK" })] });
    const result = await getPrototypeConnections(page as any, undefined, contextFor([]));
    expect(page.loads).toBe(1);
    expect(result.connections.map((c) => c.name)).toEqual(["Far"]);
  });

  test("a node on an unloaded page loads that page before scanning", async () => {
    const page = makePage("2:0", "Page 2", false);
    const far = add(page, {
      id: "2:1",
      name: "Far",
      type: "FRAME",
      reactions: [onClick({ type: "BACK" })],
    });
    await scanPrototype(far as any, undefined, contextFor([]));
    expect(page.loads).toBe(1);
  });

  test("the document root is rejected", async () => {
    await expect(getPrototypeConnections(doc as any, undefined, contextFor([]))).rejects.toThrow(
      /page/
    );
  });

  test("fileKey falls back to null when the context has none", async () => {
    const f = buildLoop();
    const result = await getPrototypeConnections(
      f.a as any,
      undefined,
      contextFor([f.b], { fileKey: undefined })
    );
    expect(result.fileKey).toBeNull();
  });
});
