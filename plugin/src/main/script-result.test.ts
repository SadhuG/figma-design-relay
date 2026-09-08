import { describe, expect, test } from "bun:test";
import { MAX_ARRAY_ITEMS, MAX_RESULT_DEPTH, toJsonSafe } from "./script-result";

/** Minimal stand-in for a Figma SceneNode: id + type + setPluginData. */
const fakeNode = (id: string, name: string, type: string) => ({
  id,
  name,
  type,
  width: 100,
  setPluginData() {},
  getPluginData() {
    return "";
  },
});

describe("toJsonSafe", () => {
  test("passes primitives through untouched", () => {
    expect(toJsonSafe("hi")).toBe("hi");
    expect(toJsonSafe(42)).toBe(42);
    expect(toJsonSafe(true)).toBe(true);
    expect(toJsonSafe(null)).toBeNull();
    expect(toJsonSafe(undefined)).toBeUndefined();
  });

  test("collapses a Figma node to id, name and type", () => {
    expect(toJsonSafe(fakeNode("1:2", "Card", "FRAME"))).toEqual({
      id: "1:2",
      name: "Card",
      type: "FRAME",
    });
  });

  test("collapses nodes nested inside plain objects and arrays", () => {
    const value = { created: [fakeNode("1:2", "Card", "FRAME")], count: 1 };
    expect(toJsonSafe(value)).toEqual({
      created: [{ id: "1:2", name: "Card", type: "FRAME" }],
      count: 1,
    });
  });

  test('renders symbols as "mixed" (figma.mixed is a symbol)', () => {
    expect(toJsonSafe({ strokeWeight: Symbol("figma.mixed") })).toEqual({
      strokeWeight: "mixed",
    });
  });

  test("replaces circular references instead of throwing", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(toJsonSafe(a)).toEqual({ name: "a", self: "[circular]" });
  });

  test("does not treat a repeated sibling reference as circular", () => {
    const shared = { k: 1 };
    expect(toJsonSafe({ x: shared, y: shared })).toEqual({ x: { k: 1 }, y: { k: 1 } });
  });

  test("stops at the depth cap", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < MAX_RESULT_DEPTH + 2; i++) deep = { next: deep };
    expect(JSON.stringify(toJsonSafe(deep))).toContain("[max depth]");
  });

  test("caps long arrays and reports how many were dropped", () => {
    const long = Array.from({ length: MAX_ARRAY_ITEMS + 5 }, (_, i) => i);
    const out = toJsonSafe(long) as unknown[];
    expect(out).toHaveLength(MAX_ARRAY_ITEMS + 1);
    expect(out[MAX_ARRAY_ITEMS]).toBe("[+5 more]");
  });

  test("stringifies values JSON cannot represent", () => {
    expect(toJsonSafe({ fn: () => 1 })).toEqual({ fn: "[function]" });
    expect(toJsonSafe({ big: 10n })).toEqual({ big: "10" });
    expect(toJsonSafe({ n: Number.NaN })).toEqual({ n: "NaN" });
    expect(toJsonSafe({ n: Number.POSITIVE_INFINITY })).toEqual({ n: "Infinity" });
  });
});

/**
 * Plugin API objects that are not nodes — `Variable`, `VariableCollection`,
 * `TextStyle`, … — expose everything through prototype getters and have no own
 * enumerable properties, so a naive `Object.keys` walk sees an empty object.
 */
const fakeVariable = (id: string, name: string) => {
  class Variable {
    get id() {
      return id;
    }
    get name() {
      return name;
    }
    get resolvedType() {
      return "COLOR";
    }
    get valuesByMode() {
      return { "1:0": { r: 1, g: 0, b: 0 } };
    }
    getPublishStatusAsync() {
      return Promise.resolve("UNPUBLISHED");
    }
  }
  return new Variable();
};

describe("toJsonSafe on prototype-getter objects", () => {
  test("serialises a Variable instead of returning an empty object", () => {
    expect(toJsonSafe(fakeVariable("VariableID:1:2", "brand/primary"))).toEqual({
      id: "VariableID:1:2",
      name: "brand/primary",
      resolvedType: "COLOR",
      valuesByMode: { "1:0": { r: 1, g: 0, b: 0 } },
    });
  });

  test("serialises an array of them, as getLocalVariablesAsync returns", () => {
    const out = toJsonSafe([fakeVariable("VariableID:1:2", "a")]) as Array<Record<string, unknown>>;
    expect(out[0].name).toBe("a");
  });

  test("reports a getter that throws rather than failing the whole result", () => {
    class Broken {
      get ok() {
        return 1;
      }
      get boom(): number {
        throw new Error("node removed");
      }
    }
    expect(toJsonSafe(new Broken())).toEqual({ ok: 1, boom: "[unreadable]" });
  });

  test("leaves a genuinely empty object empty", () => {
    expect(toJsonSafe({})).toEqual({});
  });
});
