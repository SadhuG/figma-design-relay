import { describe, expect, test } from "bun:test";
import {
  componentPropertyOwner,
  describeForCodeConnect,
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
        parent: { id: "1:1", type: "COMPONENT_SET", name: "Button" },
      }),
    });
    // setId is what a Code Connect mapping to the set is looked up by.
    expect(out?.mainComponent).toEqual({
      id: "1:2",
      key: "variantkey",
      name: "Size=M, Type=Primary",
      setId: "1:1",
      setName: "Button",
    });
  });

  test("returns undefined for a detached instance with no properties", async () => {
    const out = await serializeInstanceIdentity({ getMainComponentAsync: async () => null });
    expect(out).toBeUndefined();
  });
});

describe("describeForCodeConnect", () => {
  const described = {
    ...set,
    description: "Primary call to action",
    componentPropertyDefinitions: {
      Size: { type: "VARIANT", defaultValue: "M", variantOptions: ["S", "M", "L"] },
      Label: { type: "TEXT", defaultValue: "Go" },
    },
  };
  const child = { ...variant, parent: described };

  test("returns the property definitions and the variant axes", () => {
    const out = describeForCodeConnect(described);
    expect(out.propertyDefinitions).toEqual(described.componentPropertyDefinitions);
    expect(out.variantAxes).toEqual([{ name: "Size", options: ["S", "M", "L"] }]);
  });

  test("names the set, not the variant, when given a variant", () => {
    const out = describeForCodeConnect(child);
    expect(out).toMatchObject({ id: "1:1", name: "Button", key: "setkey" });
    expect(out.selectedVariant).toEqual({ id: "1:2", name: "Size=M" });
  });

  test("carries the designer's description", () => {
    expect(describeForCodeConnect(described).description).toBe("Primary call to action");
  });

  test("describes a standalone component with no properties", () => {
    const out = describeForCodeConnect(standalone);
    expect(out).toMatchObject({ id: "2:1", name: "Divider", propertyDefinitions: {} });
    expect(out.variantAxes).toEqual([]);
  });

  test("refuses an instance and names its main component", () => {
    expect(() =>
      describeForCodeConnect({ id: "5:5", type: "INSTANCE", name: "Button" }, "1:2")
    ).toThrow(/main component.*1:2/);
  });

  test("refuses a frame, saying what Code Connect maps", () => {
    expect(() => describeForCodeConnect({ id: "3:1", type: "FRAME" })).toThrow(
      /COMPONENT or COMPONENT_SET/
    );
  });
});

describe("serializeInstanceIdentity library components", () => {
  // A library component's id here is not its id in the library file, so a
  // Code Connect mapping to it cannot be matched — the flag lets the relay say so.
  test("marks a main component that comes from a library", async () => {
    const out = await serializeInstanceIdentity({
      getMainComponentAsync: async () => ({ id: "1:2", key: "k", name: "Button", remote: true }),
    });
    expect(out?.mainComponent?.remote).toBe(true);
  });

  test("omits the flag for a local component", async () => {
    const out = await serializeInstanceIdentity({
      getMainComponentAsync: async () => ({ id: "1:2", key: "k", name: "Button", remote: false }),
    });
    expect(out?.mainComponent).not.toHaveProperty("remote");
  });
});
