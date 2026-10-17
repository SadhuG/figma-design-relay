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
