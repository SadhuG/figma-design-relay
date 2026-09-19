import { describe, expect, test } from "bun:test";
import {
  serializeAnnotations,
  serializeExportSettings,
  serializeLayoutIntent,
  serializeReactions,
  serializeRenderBounds,
} from "./intent";

describe("serializeLayoutIntent", () => {
  test("returns undefined for a node with no layout intent", () => {
    expect(serializeLayoutIntent({ layoutGrow: 0, layoutAlign: "INHERIT" })).toBeUndefined();
  });

  // Every layout-capable node reports FIXED sizing by default, so emitting it
  // would put a layout block on essentially every node in a file.
  test("treats FIXED sizing as the default and omits it", () => {
    expect(
      serializeLayoutIntent({ layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" })
    ).toBeUndefined();
    expect(
      serializeLayoutIntent({ layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED" })
    ).toEqual({ sizingHorizontal: "FILL" });
  });

  test("emits hug and fill sizing", () => {
    expect(
      serializeLayoutIntent({ layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" })
    ).toEqual({ sizingHorizontal: "FILL", sizingVertical: "HUG" });
  });

  test("omits defaults but keeps non-defaults", () => {
    expect(
      serializeLayoutIntent({
        layoutGrow: 1,
        layoutAlign: "INHERIT",
        layoutPositioning: "ABSOLUTE",
        itemReverseZIndex: false,
      })
    ).toEqual({ grow: 1, positioning: "ABSOLUTE" });
  });

  test("carries min and max constraints", () => {
    expect(serializeLayoutIntent({ minWidth: 120, maxHeight: 400 })).toEqual({
      minWidth: 120,
      maxHeight: 400,
    });
  });
});

describe("serializeReactions", () => {
  test("returns undefined when there are none", () => {
    expect(serializeReactions({ reactions: [] })).toBeUndefined();
    expect(serializeReactions({})).toBeUndefined();
  });

  test("summarises a navigate reaction", () => {
    const out = serializeReactions({
      reactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [{ type: "NODE", destinationId: "4:5", navigation: "NAVIGATE" }],
        },
      ],
    });
    expect(out).toEqual([
      {
        trigger: "ON_CLICK",
        actions: [{ type: "NODE", destinationId: "4:5", navigation: "NAVIGATE" }],
      },
    ]);
  });
});

describe("serializeAnnotations", () => {
  test("returns undefined when there are none", () => {
    expect(serializeAnnotations({ annotations: [] })).toBeUndefined();
  });

  test("keeps the label and the pinned property types", () => {
    const out = serializeAnnotations({
      annotations: [{ label: "Uses the brand token", properties: [{ type: "fills" }] }],
    });
    expect(out).toEqual([{ label: "Uses the brand token", properties: ["fills"] }]);
  });
});

describe("serializeExportSettings", () => {
  test("returns undefined when the node is not exportable", () => {
    expect(serializeExportSettings({ exportSettings: [] })).toBeUndefined();
  });

  test("summarises a scaled PNG export", () => {
    const out = serializeExportSettings({
      exportSettings: [{ format: "PNG", suffix: "@2x", constraint: { type: "SCALE", value: 2 } }],
    });
    expect(out).toEqual([
      { format: "PNG", suffix: "@2x", constraint: { type: "SCALE", value: 2 } },
    ]);
  });
});

describe("serializeRenderBounds", () => {
  test("omits render bounds that match the bounding box", () => {
    const box = { x: 0, y: 0, width: 100, height: 50 };
    expect(
      serializeRenderBounds({ absoluteBoundingBox: box, absoluteRenderBounds: { ...box } })
    ).toBeUndefined();
  });

  test("emits render bounds when a shadow makes them differ", () => {
    expect(
      serializeRenderBounds({
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
        absoluteRenderBounds: { x: -4, y: -4, width: 108, height: 58 },
      })
    ).toEqual({ x: -4, y: -4, width: 108, height: 58 });
  });
});
