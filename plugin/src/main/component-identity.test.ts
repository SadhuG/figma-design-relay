import { describe, expect, test } from "bun:test";
import {
  componentPropertyOwner,
  serializeComponentIdentity,
  serializeInstanceIdentity,
} from "./component-identity";

const set = {
  id: "1:1",
  type: "COMPONENT_SET",
  name: "Button",
  key: "setkey",
  componentPropertyDefinitions: { Size: { type: "VARIANT", defaultValue: "M" } },
};

const variant = {
  id: "1:2",
  type: "COMPONENT",
  name: "Size=M",
  key: "variantkey",
  parent: set,
};

const standalone = {
  id: "2:1",
  type: "COMPONENT",
  name: "Divider",
  key: "dividerkey",
  parent: { id: "0:1", type: "FRAME" },
  componentPropertyDefinitions: {},
};

describe("componentPropertyOwner", () => {
  test("a component set owns its own definitions", () => {
    expect(componentPropertyOwner(set)?.id).toBe("1:1");
  });

  test("a variant promotes to its parent set", () => {
    expect(componentPropertyOwner(variant)?.id).toBe("1:1");
  });

  test("a standalone component owns its own definitions", () => {
    expect(componentPropertyOwner(standalone)?.id).toBe("2:1");
  });

  test("a non-component has no owner", () => {
    expect(componentPropertyOwner({ id: "3:1", type: "FRAME" })).toBeNull();
  });
});

describe("serializeComponentIdentity", () => {
  test("emits the key and the definitions for a set", () => {
    expect(serializeComponentIdentity(set)).toEqual({
      key: "setkey",
      propertyDefinitions: { Size: { type: "VARIANT", defaultValue: "M" } },
    });
  });

  test("names the owner when a variant borrows its parent's definitions", () => {
    expect(serializeComponentIdentity(variant)).toEqual({
      key: "variantkey",
      propertyDefinitions: { Size: { type: "VARIANT", defaultValue: "M" } },
      propertyOwnerId: "1:1",
    });
  });

  test("omits empty definitions", () => {
    expect(serializeComponentIdentity(standalone)).toEqual({ key: "dividerkey" });
  });

  test("returns undefined for a non-component", () => {
    expect(serializeComponentIdentity({ id: "3:1", type: "FRAME" })).toBeUndefined();
  });
});

describe("serializeInstanceIdentity", () => {
  test("resolves the main component asynchronously", async () => {
    const out = await serializeInstanceIdentity({
      getMainComponentAsync: async () => ({ id: "1:2", key: "variantkey", name: "Size=M" }),
      componentProperties: { Label: { type: "TEXT", value: "Save" } },
    });
    expect(out).toEqual({
      mainComponent: { id: "1:2", key: "variantkey", name: "Size=M" },
      componentProperties: { Label: { type: "TEXT", value: "Save" } },
    });
  });

  // A variant's own name is its property string ("Size=M, Type=Primary"); the
  // name an agent needs is the component set's — "Button" — with the variant
  // kept as detail.
  test("names the component set when the main component is a variant", async () => {
    const out = await serializeInstanceIdentity({
      getMainComponentAsync: async () => ({
        id: "1:2",
        key: "variantkey",
        name: "Size=M, Type=Primary",
        parent: { type: "COMPONENT_SET", name: "Button" },
      }),
    });
    expect(out?.mainComponent).toEqual({
      id: "1:2",
      key: "variantkey",
      name: "Size=M, Type=Primary",
      setName: "Button",
    });
  });

  test("returns undefined for a detached instance with no properties", async () => {
    const out = await serializeInstanceIdentity({ getMainComponentAsync: async () => null });
    expect(out).toBeUndefined();
  });
});
