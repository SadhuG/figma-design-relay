import { describe, expect, test } from "bun:test";
import { assertTextPropertiesSupported, getTextTargetById } from "./text-target";

const sublayer = { characters: "label" };
const nodes: Record<string, any> = {
  "1:1": { id: "1:1", name: "Title", type: "TEXT", characters: "hi" },
  "1:2": { id: "1:2", name: "Note", type: "STICKY", text: sublayer },
  "1:3": { id: "1:3", name: "Box", type: "SHAPE_WITH_TEXT", text: sublayer, resize() {} },
  "1:4": { id: "1:4", name: "Rect", type: "RECTANGLE" },
  "0:1": { id: "0:1", name: "Page", type: "PAGE" },
};
const lookup = async (id: string) => nodes[id] ?? null;

describe("getTextTargetById", () => {
  test("a TEXT node is its own target", async () => {
    const target = await getTextTargetById("1:1", "set_text_content", lookup);
    expect(target.kind).toBe("text");
    expect(target.node).toBe(nodes["1:1"]);
    expect(target.text).toBe(nodes["1:1"]);
  });

  test("a sticky or a shape with text edits its text sublayer, reporting the outer node", async () => {
    for (const id of ["1:2", "1:3"]) {
      const target = await getTextTargetById(id, "set_text_content", lookup);
      expect(target.kind).toBe("sublayer");
      expect(target.node.id).toBe(id);
      expect(target.text).toBe(sublayer);
    }
  });

  test("other nodes are refused with the tool's name and the type found", async () => {
    await expect(getTextTargetById("1:4", "set_text_properties", lookup)).rejects.toThrow(
      /^set_text_properties supports TEXT, STICKY and SHAPE_WITH_TEXT nodes \(got RECTANGLE: 1:4\)/
    );
    await expect(getTextTargetById("0:1", "set_text_content", lookup)).rejects.toThrow(/0:1/);
    await expect(getTextTargetById("9:9", "set_text_content", lookup)).rejects.toThrow(/not found/);
  });
});

describe("assertTextPropertiesSupported", () => {
  test("a TEXT node takes every property", async () => {
    const target = await getTextTargetById("1:1", "set_text_properties", lookup);
    expect(() =>
      assertTextPropertiesSupported(target, {
        textAlignHorizontal: "LEFT",
        textAlignVertical: "TOP",
        textAutoResize: "HEIGHT",
        width: 10,
      })
    ).not.toThrow();
  });

  test("alignment and auto-resize are refused on a FigJam text sublayer", async () => {
    const target = await getTextTargetById("1:2", "set_text_properties", lookup);
    for (const key of ["textAlignHorizontal", "textAlignVertical", "textAutoResize"]) {
      expect(() => assertTextPropertiesSupported(target, { [key]: "CENTER", fontSize: 4 })).toThrow(
        key
      );
    }
    expect(() =>
      assertTextPropertiesSupported(target, { fontSize: 4, fillHex: "#000" })
    ).not.toThrow();
  });

  test("a sticky cannot be resized, a shape with text can", async () => {
    const sticky = await getTextTargetById("1:2", "set_text_properties", lookup);
    const shape = await getTextTargetById("1:3", "set_text_properties", lookup);
    expect(() => assertTextPropertiesSupported(sticky, { width: 10 })).toThrow(/resiz/);
    expect(() => assertTextPropertiesSupported(shape, { width: 10 })).not.toThrow();
  });
});
