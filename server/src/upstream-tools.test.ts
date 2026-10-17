import { beforeEach, describe, expect, test } from "bun:test";
import { validateRpc } from "./schema.js";
import { registerTools } from "./tools.js";

/**
 * Captures every registered handler and runs each send through `validateRpc`,
 * so a handler test also proves its payload survives the follower → leader hop:
 * what the plugin would receive is the validated params plus the transport ids.
 */
interface SentRequest {
  type: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
  fileKey?: string;
}

const handlers = new Map<string, (...args: any[]) => Promise<any>>();
const registrations: string[] = [];
const sent: SentRequest[] = [];

const node = {
  listConnectedFiles: () => [],
  async send(type: string, nodeIds?: string[], fileKey?: string) {
    return node.sendWithParams(type, nodeIds, undefined, fileKey);
  },
  async sendWithParams(
    type: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    fileKey?: string
  ) {
    const validation = validateRpc(type, nodeIds, params);
    if (validation.error) return { type, requestId: "r", error: validation.error };
    sent.push({ type, nodeIds, params: validation.params ?? params, fileKey });
    return { type, requestId: "r", data: { ok: true } };
  },
};

beforeEach(() => {
  handlers.clear();
  registrations.length = 0;
  sent.length = 0;
  registerTools(
    {
      tool(name: string, ...args: any[]) {
        registrations.push(name);
        handlers.set(name, args.at(-1));
      },
    } as any,
    node as any,
    0
  );
});

const call = async (name: string, args: Record<string, unknown>) => {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} is not registered`);
  return handler(args);
};

const NEW_TOOLS = [
  "get_prototype_connections",
  "trace_prototype_flow",
  "create_svg",
  "fit_to_content",
  "distribute_horizontally",
  "distribute_vertically",
  "align_to_grid",
  "place_below",
  "place_right_of",
  "duplicate_with_offset",
];

describe("upstream tool registrations", () => {
  test("each of the ten new tools is registered exactly once", () => {
    for (const name of NEW_TOOLS) {
      expect(registrations.filter((n) => n === name).length, name).toBe(1);
    }
  });

  test("no tool is registered twice", () => {
    expect(new Set(registrations).size).toBe(registrations.length);
  });
});

describe("node-addressed requests survive the follower hop", () => {
  test("get_node forwards includePrototype with its id and fileKey", async () => {
    const result = await call("get_node", { nodeId: "1:2", includePrototype: true, fileKey: "k" });
    expect(result.isError).toBeUndefined();
    expect(sent).toEqual([
      { type: "get_node", nodeIds: ["1:2"], params: { includePrototype: true }, fileKey: "k" },
    ]);
  });

  test("a two-node property batch reaches both nodes with only the patch", async () => {
    const result = await call("set_node_properties", {
      nodeIds: ["1:2", "I1:3;4:5"],
      visible: false,
      fileKey: "k",
    });
    expect(result.isError).toBeUndefined();
    expect(sent).toEqual([
      {
        type: "set_node_properties",
        nodeIds: ["1:2", "I1:3;4:5"],
        params: { visible: false },
        fileKey: "k",
      },
    ]);
  });
});

describe("prototype tools", () => {
  test("get_prototype_connections sends an instance-child root on nodeIds", async () => {
    const result = await call("get_prototype_connections", {
      nodeId: "I1:2;3:4",
      maxNodes: 10,
      includeEmpty: true,
      fileKey: "k",
    });
    expect(result.isError).toBeUndefined();
    expect(sent).toEqual([
      {
        type: "get_prototype_connections",
        nodeIds: ["I1:2;3:4"],
        params: { maxNodes: 10, includeEmpty: true },
        fileKey: "k",
      },
    ]);
  });

  test("get_prototype_connections without a root sends no ids", async () => {
    await call("get_prototype_connections", { fileKey: "k" });
    expect(sent).toEqual([
      { type: "get_prototype_connections", nodeIds: undefined, params: {}, fileKey: "k" },
    ]);
  });

  test("trace_prototype_flow sends its start and limits", async () => {
    await call("trace_prototype_flow", { nodeId: "1:2", maxScreens: 4, fileKey: "k" });
    expect(sent).toEqual([
      { type: "trace_prototype_flow", nodeIds: ["1:2"], params: { maxScreens: 4 }, fileKey: "k" },
    ]);
  });
});

describe("create_svg", () => {
  test("inline markup reaches the plugin as svgText with its placement and fileKey", async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
    const result = await call("create_svg", {
      source: svg,
      name: "Logo",
      parentId: "1:2",
      x: 4,
      width: 10,
      fileKey: "k",
    });
    expect(result.isError).toBeUndefined();
    expect(sent).toEqual([
      {
        type: "create_svg",
        nodeIds: undefined,
        params: { svgText: svg, name: "Logo", parentId: "1:2", x: 4, width: 10 },
        fileKey: "k",
      },
    ]);
  });

  test("markup without an svg root never reaches the plugin", async () => {
    const result = await call("create_svg", { source: "<html/>", fileKey: "k" });
    expect(result.isError).toBe(true);
    expect(sent).toEqual([]);
  });
});

describe("set_node_properties", () => {
  test("the old single nodeId form still works", async () => {
    const result = await call("set_node_properties", { nodeId: "1:2", visible: false });
    expect(result.isError).toBeUndefined();
    expect(sent).toEqual([
      {
        type: "set_node_properties",
        nodeIds: ["1:2"],
        params: { visible: false },
        fileKey: undefined,
      },
    ]);
  });

  test("nodeIds wins when both forms are given", async () => {
    await call("set_node_properties", { nodeId: "1:2", nodeIds: ["3:4"], x: 1 });
    expect(sent[0].nodeIds).toEqual(["3:4"]);
  });

  test("missing ids, an empty id list and an empty patch are refused before sending", async () => {
    for (const args of [{ visible: true }, { nodeIds: [], visible: true }, { nodeId: "1:2" }]) {
      const result = await call("set_node_properties", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(sent).toEqual([]);
  });
});

describe("node-list tools keep their transport ids", () => {
  test("duplicate, reparent, group and delete still reach the plugin with ids", async () => {
    await call("duplicate_nodes", { nodeIds: ["1:2"], fileKey: "k" });
    await call("reparent_nodes", { nodeIds: ["1:2"], parentId: "3:4", fileKey: "k" });
    await call("group_nodes", { nodeIds: ["1:2", "1:3"], fileKey: "k" });
    await call("delete_nodes", { nodeIds: ["1:2"], confirm: true, fileKey: "k" });
    expect(sent.map((r) => [r.type, r.nodeIds, r.params])).toEqual([
      ["duplicate_nodes", ["1:2"], {}],
      ["reparent_nodes", ["1:2"], { parentId: "3:4" }],
      ["group_nodes", ["1:2", "1:3"], {}],
      ["delete_nodes", ["1:2"], { confirm: true }],
    ]);
  });
});

describe("layout helpers survive the follower hop", () => {
  test("each helper sends its ids on nodeIds and its options as params", async () => {
    await call("fit_to_content", { nodeId: "1:1", padding: 4, fileKey: "k" });
    await call("distribute_horizontally", { nodeIds: ["1:1", "1:2", "I1:3;4:5"], fileKey: "k" });
    await call("distribute_vertically", { nodeIds: ["1:1", "1:2", "1:3"], fileKey: "k" });
    await call("align_to_grid", { nodeIds: ["1:1"], gridSize: 8, fileKey: "k" });
    await call("place_below", {
      nodeId: "1:1",
      relativeToId: "1:2",
      gap: 3,
      align: "center",
      fileKey: "k",
    });
    await call("place_right_of", { nodeId: "I1:3;4:5", relativeToId: "1:2", fileKey: "k" });
    await call("duplicate_with_offset", {
      nodeIds: ["1:1"],
      offsetX: 5,
      offsetY: -3,
      fileKey: "k",
    });
    expect(
      sent.map((r) => [r.type, r.nodeIds, JSON.parse(JSON.stringify(r.params ?? {})), r.fileKey])
    ).toEqual([
      ["fit_to_content", ["1:1"], { padding: 4 }, "k"],
      ["distribute_horizontally", ["1:1", "1:2", "I1:3;4:5"], {}, "k"],
      ["distribute_vertically", ["1:1", "1:2", "1:3"], {}, "k"],
      ["align_to_grid", ["1:1"], { gridSize: 8 }, "k"],
      ["place_below", ["1:1"], { relativeToId: "1:2", gap: 3, align: "center" }, "k"],
      ["place_right_of", ["I1:3;4:5"], { relativeToId: "1:2" }, "k"],
      ["duplicate_with_offset", ["1:1"], { offsetX: 5, offsetY: -3 }, "k"],
    ]);
  });
});

describe("FigJam creators", () => {
  test("create_sticky normalises characters onto text before sending", async () => {
    await call("create_sticky", { characters: "Idea", isWideWidth: true, fileKey: "k" });
    expect(sent).toEqual([
      {
        type: "create_sticky",
        nodeIds: undefined,
        params: { text: "Idea", isWideWidth: true },
        fileKey: "k",
      },
    ]);
  });

  test("create_connector with a floating start reaches the plugin", async () => {
    const result = await call("create_connector", {
      startX: 0,
      startY: 0,
      endNodeId: "1:2",
      text: "go",
      fileKey: "k",
    });
    expect(result.isError).toBeUndefined();
    expect(sent[0].params).toEqual({ startX: 0, startY: 0, endNodeId: "1:2", text: "go" });
  });

  test("a half coordinate is refused before sending", async () => {
    const result = await call("create_connector", { startX: 0, endNodeId: "1:2" });
    expect(result.isError).toBe(true);
    expect(sent).toEqual([]);
  });
});
