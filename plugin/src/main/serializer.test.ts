import { beforeAll, describe, expect, test } from "bun:test";

/**
 * Minimal `figma` global. The serializer must not reach it for a node that
 * carries no design-system reference; these stubs throw if it does.
 */
beforeAll(() => {
  (globalThis as Record<string, unknown>).figma = {
    getStyleByIdAsync: async (id: string) => (id === "S:abc" ? { name: "Body/Regular" } : null),
    variables: {
      getVariableByIdAsync: async (id: string) =>
        id === "VariableID:1:2"
          ? { name: "color/brand/primary", variableCollectionId: "VariableCollectionId:1:1" }
          : null,
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
