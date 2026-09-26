import { beforeAll, describe, expect, test } from "bun:test";

/**
 * Minimal `figma` global. The serializer must not reach it for a node that
 * carries no design-system reference; these stubs throw if it does.
 */
beforeAll(() => {
  (globalThis as Record<string, unknown>).figma = {
    getStyleByIdAsync: async (id: string) => {
      if (id === "S:offline") throw new Error("Unable to establish connection to Figma");
      return id === "S:abc" ? { name: "Body/Regular" } : null;
    },
    variables: {
      getVariableByIdAsync: async (id: string) => {
        if (id === "VariableID:9:9") throw new Error("Unable to establish connection to Figma");
        return id === "VariableID:1:2"
          ? { name: "color/brand/primary", variableCollectionId: "VariableCollectionId:1:1" }
          : null;
      },
      getVariableCollectionByIdAsync: async () => ({ name: "Brand" }),
    },
  };
});

const { serializeNode } = await import("./serializer");

const rectangle = {
  id: "1:5",
  name: "Divider",
  type: "RECTANGLE",
  visible: true,
  opacity: 1,
  blendMode: "PASS_THROUGH",
  fills: [],
  strokes: [],
  effects: [],
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 1 },
} as unknown as SceneNode;

describe("serializeNode", () => {
  test("a plain rectangle gains no new keys", async () => {
    const out = await serializeNode(rectangle);
    expect(Object.keys(out).sort()).toEqual(["bounds", "id", "name", "styles", "type"]);
  });

  test("an instance carries its main component", async () => {
    const out = await serializeNode({
      ...rectangle,
      id: "1:6",
      type: "INSTANCE",
      getMainComponentAsync: async () => ({ id: "9:1", key: "btnkey", name: "Button/Primary" }),
      componentProperties: { Label: { type: "TEXT", value: "Save" } },
    } as unknown as SceneNode);
    expect(out.design?.mainComponent).toEqual({
      id: "9:1",
      key: "btnkey",
      name: "Button/Primary",
    });
  });

  test("a bound fill resolves to its token name", async () => {
    const out = await serializeNode({
      ...rectangle,
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:1:2" }] },
    } as unknown as SceneNode);
    expect(out.design?.boundVariables?.[0]).toMatchObject({
      property: "fills[0]",
      variableName: "color/brand/primary",
      collectionName: "Brand",
    });
  });

  test("a named text style resolves to its style name", async () => {
    const out = await serializeNode({
      ...rectangle,
      fillStyleId: "S:abc",
    } as unknown as SceneNode);
    expect(out.design?.styles?.fill).toEqual({ id: "S:abc", name: "Body/Regular" });
  });

  // Library tokens, styles and components live on Figma's servers. When that
  // fetch fails the node still serializes — with the bare id — rather than the
  // whole document call failing.
  test("a variable lookup that throws degrades to the bare id", async () => {
    const out = await serializeNode({
      ...rectangle,
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:9:9" }] },
    } as unknown as SceneNode);
    expect(out.design?.boundVariables?.[0]).toEqual({
      property: "fills[0]",
      variableId: "VariableID:9:9",
    });
  });

  test("a style lookup that throws degrades to the bare id", async () => {
    const out = await serializeNode({
      ...rectangle,
      fillStyleId: "S:offline",
    } as unknown as SceneNode);
    expect(out.design?.styles?.fill).toEqual({ id: "S:offline" });
  });

  test("a main component lookup that throws leaves the instance without identity", async () => {
    const out = await serializeNode({
      ...rectangle,
      id: "1:11",
      type: "INSTANCE",
      getMainComponentAsync: async () => {
        throw new Error("Unable to establish connection to Figma");
      },
    } as unknown as SceneNode);
    expect(out.type).toBe("INSTANCE");
    expect(out.design?.mainComponent).toBeUndefined();
  });

  test("layout intent rides along when it is not at defaults", async () => {
    const out = await serializeNode({
      ...rectangle,
      layoutSizingHorizontal: "FILL",
    } as unknown as SceneNode);
    expect(out.layout).toEqual({ sizingHorizontal: "FILL" });
  });

  test("children are serialized concurrently and in order", async () => {
    const out = await serializeNode({
      ...rectangle,
      id: "1:7",
      type: "FRAME",
      children: [
        { ...rectangle, id: "1:8", name: "A" },
        { ...rectangle, id: "1:9", name: "B", visible: false },
        { ...rectangle, id: "1:10", name: "C" },
      ],
    } as unknown as SceneNode);
    expect(out.children?.map((child) => child.name)).toEqual(["A", "C"]);
  });
});

describe("serializeNode depth limit", () => {
  const leaf = { ...rectangle, id: "3:3", name: "Leaf" };
  const inner = { ...rectangle, id: "3:2", name: "Inner", type: "FRAME", children: [leaf] };
  const root = {
    ...rectangle,
    id: "3:1",
    name: "Root",
    type: "FRAME",
    children: [inner, { ...leaf, id: "3:4", visible: false }],
  } as unknown as SceneNode;

  // get_design_context bounds its output by depth. The cut has to happen inside
  // the one walk — re-serializing every subtree and discarding it multiplied the
  // async lookups by the depth, which is what timed out on library-heavy pages.
  test("stops at maxDepth and reports the visible child count instead", async () => {
    const out = await serializeNode(root, { maxDepth: 1 });
    expect(out.children?.map((c) => c.id)).toEqual(["3:2"]);
    const cut = out.children?.[0] as SerializedNodeWithCount;
    expect(cut.children).toBeUndefined();
    expect(cut.childCount).toBe(1);
  });

  test("counts only visible children at the cut", async () => {
    const out = (await serializeNode(root, { maxDepth: 0 })) as SerializedNodeWithCount;
    expect(out.children).toBeUndefined();
    expect(out.childCount).toBe(1);
  });

  test("walks the whole tree when no depth is given", async () => {
    const out = await serializeNode(root);
    expect(out.children?.[0].children?.[0].id).toBe("3:3");
  });
});

type SerializedNodeWithCount = Awaited<ReturnType<typeof serializeNode>> & { childCount?: number };

// FigJam nodes carry their meaning in fields a design node does not have — a
// connector is nothing without its endpoints, a sticky nothing without its text.
describe("serializeNode on a FigJam board", () => {
  test("a connector keeps the ids it joins", async () => {
    const out = await serializeNode({
      ...rectangle,
      id: "4:3",
      type: "CONNECTOR",
      connectorStart: { endpointNodeId: "4:1", magnet: "AUTO" },
      connectorEnd: { endpointNodeId: "4:2", magnet: "AUTO" },
      connectorLineType: "ELBOWED",
      text: { characters: "then" },
    } as unknown as SceneNode);
    expect(out.connector).toEqual({ from: "4:1", to: "4:2", lineType: "ELBOWED" });
    expect(out.text).toBe("then");
  });

  test("a section serializes with its children", async () => {
    const out = await serializeNode({
      ...rectangle,
      id: "4:9",
      type: "SECTION",
      children: [{ ...rectangle, id: "4:10", type: "STICKY", text: { characters: "Idea" } }],
    } as unknown as SceneNode);
    expect(out.type).toBe("SECTION");
    expect(out.children?.[0].text).toBe("Idea");
  });
});
