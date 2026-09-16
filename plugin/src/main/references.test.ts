import { describe, expect, test } from "bun:test";
import { resolveBoundVariables, resolveStyleRef } from "./references";

const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });

const lookupVariable = async (id: string) =>
  id === "VariableID:1:2"
    ? { name: "color/brand/primary", variableCollectionId: "VariableCollectionId:1:1" }
    : null;

const lookupCollection = async (id: string) =>
  id === "VariableCollectionId:1:1" ? { name: "Brand" } : null;

const lookupStyle = async (id: string) => (id === "S:abc" ? { name: "Body/Regular" } : null);

describe("resolveBoundVariables", () => {
  test("returns undefined when there is nothing bound", async () => {
    expect(
      await resolveBoundVariables(undefined, lookupVariable, lookupCollection)
    ).toBeUndefined();
    expect(await resolveBoundVariables({}, lookupVariable, lookupCollection)).toBeUndefined();
  });

  test("resolves a scalar binding to its variable and collection name", async () => {
    const out = await resolveBoundVariables(
      { cornerRadius: alias("VariableID:1:2") },
      lookupVariable,
      lookupCollection
    );
    expect(out).toEqual([
      {
        property: "cornerRadius",
        variableId: "VariableID:1:2",
        variableName: "color/brand/primary",
        collectionName: "Brand",
      },
    ]);
  });

  test("indexes array bindings by position", async () => {
    const out = await resolveBoundVariables(
      { fills: [alias("VariableID:1:2")] },
      lookupVariable,
      lookupCollection
    );
    expect(out?.[0].property).toBe("fills[0]");
  });

  test("keeps the id when the variable cannot be found", async () => {
    const out = await resolveBoundVariables(
      { opacity: alias("VariableID:9:9") },
      lookupVariable,
      lookupCollection
    );
    expect(out).toEqual([{ property: "opacity", variableId: "VariableID:9:9" }]);
  });

  test("ignores entries that are not variable aliases", async () => {
    const out = await resolveBoundVariables(
      { fills: ["not an alias"], name: null },
      lookupVariable,
      lookupCollection
    );
    expect(out).toBeUndefined();
  });
});

describe("resolveStyleRef", () => {
  test('renders a mixed style id as "mixed"', async () => {
    expect(await resolveStyleRef(Symbol("figma.mixed"), lookupStyle)).toBe("mixed");
  });

  test("returns undefined for an unset style", async () => {
    expect(await resolveStyleRef("", lookupStyle)).toBeUndefined();
    expect(await resolveStyleRef(undefined, lookupStyle)).toBeUndefined();
  });

  test("resolves a known style to its name", async () => {
    expect(await resolveStyleRef("S:abc", lookupStyle)).toEqual({
      id: "S:abc",
      name: "Body/Regular",
    });
  });

  test("keeps the id when the style cannot be found", async () => {
    expect(await resolveStyleRef("S:gone", lookupStyle)).toEqual({ id: "S:gone" });
  });
});
