import { describe, expect, test } from "bun:test";
import type { ConnectedFile } from "../types.js";
import { mergeSearchResults, type FileHit, type FileOutcome } from "./merge.js";

const system: ConnectedFile = {
  fileKey: "k-sys",
  fileName: "Acme Design System",
  editorType: "figma",
};
const checkout: ConnectedFile = {
  fileKey: "k-co",
  fileName: "Checkout Screens",
  editorType: "figma",
};
const onboarding: ConnectedFile = { fileKey: "k-on", fileName: "Onboarding", editorType: "figma" };

const SCOPES = [
  "components and component instances on the current page",
  "published variable collections",
];

const answered = (file: ConnectedFile, results: FileHit[], extra: object = {}): FileOutcome => ({
  file,
  result: { results, searched: SCOPES, note: "per-file note", ...extra },
});

const button = (id: string, remote?: boolean): FileHit => ({
  id,
  name: "Button",
  kind: "componentSet",
  key: "btn",
  score: 1,
  ...(remote ? { remote: true } : {}),
});

describe("mergeSearchResults grouping", () => {
  test("one entry per component, pointing at the original, with the other files under alsoIn", () => {
    const merged = mergeSearchResults({
      outcomes: [
        answered(checkout, [button("5:1", true)]),
        answered(system, [button("1:1")]),
        answered(onboarding, [button("7:1", true)]),
      ],
      skipped: [],
    });
    expect(merged.results).toEqual([
      {
        id: "1:1",
        name: "Button",
        kind: "componentSet",
        key: "btn",
        score: 1,
        fileKey: "k-sys",
        fileName: "Acme Design System",
        alsoIn: [
          { fileKey: "k-co", fileName: "Checkout Screens", id: "5:1" },
          { fileKey: "k-on", fileName: "Onboarding", id: "7:1" },
        ],
      },
    ]);
  });

  test("points at the first file's copy when no open file holds the original", () => {
    const merged = mergeSearchResults({
      outcomes: [
        answered(checkout, [button("5:1", true)]),
        answered(onboarding, [button("7:1", true)]),
      ],
      skipped: [],
    });
    expect(merged.results[0]).toMatchObject({
      id: "5:1",
      fileName: "Checkout Screens",
      remote: true,
    });
    expect(merged.results[0].alsoIn).toEqual([
      { fileKey: "k-on", fileName: "Onboarding", id: "7:1" },
    ]);
  });

  test("never merges hits without a key, or the same key under different kinds", () => {
    const unkeyed: FileHit = { id: "9:1", name: "Promo Button", kind: "component", score: 0.9 };
    const sameKeyComponent: FileHit = { ...button("2:2"), kind: "component" };
    const merged = mergeSearchResults({
      outcomes: [
        answered(system, [button("1:1"), unkeyed]),
        answered(checkout, [sameKeyComponent, unkeyed]),
      ],
      skipped: [],
    });
    expect(merged.results.map((hit) => `${hit.fileKey}/${hit.id}`).sort()).toEqual([
      "k-co/2:2",
      "k-co/9:1",
      "k-sys/1:1",
      "k-sys/9:1",
    ]);
    expect(merged.results.every((hit) => hit.alsoIn === undefined)).toBe(true);
  });

  test("lists a library variable collection once", () => {
    const colors: FileHit = {
      id: "c1",
      key: "c1",
      name: "Colors",
      kind: "variableCollection",
      libraryName: "Core",
      score: 1,
    };
    const merged = mergeSearchResults({
      outcomes: [answered(system, [colors]), answered(checkout, [colors])],
      skipped: [],
    });
    expect(merged.results).toHaveLength(1);
    expect(merged.results[0]).toMatchObject({
      fileName: "Acme Design System",
      alsoIn: [{ fileKey: "k-co", fileName: "Checkout Screens", id: "c1" }],
    });
  });
});

describe("mergeSearchResults ordering and cap", () => {
  test("orders by score, then originals before library copies, then name", () => {
    const hits: FileHit[] = [
      { id: "a", name: "Zeta", kind: "component", key: "z", score: 0.9 },
      { id: "b", name: "Alpha", kind: "component", key: "a", score: 0.9, remote: true },
      { id: "c", name: "Beta", kind: "component", key: "b", score: 0.9 },
      { id: "d", name: "Top", kind: "component", key: "t", score: 1 },
    ];
    const merged = mergeSearchResults({ outcomes: [answered(system, hits)], skipped: [] });
    expect(merged.results.map((hit) => hit.name)).toEqual(["Top", "Beta", "Zeta", "Alpha"]);
  });

  test("caps at limit and reports the merged total", () => {
    const hits: FileHit[] = ["A", "B", "C"].map((name) => ({
      id: name,
      name,
      kind: "component",
      key: name,
      score: 1,
    }));
    const merged = mergeSearchResults({
      outcomes: [answered(system, hits)],
      skipped: [],
      limit: 2,
    });
    expect(merged.results).toHaveLength(2);
    expect(merged.total).toBe(3);
    expect(merged.note).toContain("Only the 2 strongest of 3");
  });

  test("omits total when nothing was cut", () => {
    expect(
      mergeSearchResults({ outcomes: [answered(system, [button("1:1")])], skipped: [] }).total
    ).toBeUndefined();
  });
});

describe("mergeSearchResults files and errors", () => {
  test("lists searched and skipped files, turning a failure into a skip with the recovery step", () => {
    const merged = mergeSearchResults({
      outcomes: [
        answered(system, [button("1:1")]),
        { file: checkout, error: "Plugin disconnected: Checkout Screens (k-co)" },
      ],
      skipped: [{ fileKey: "k-fj", fileName: "Q3 Brainstorm", reason: "Skipped: a FigJam board." }],
    });
    expect(merged.files.searched).toEqual([{ fileKey: "k-sys", fileName: "Acme Design System" }]);
    expect(merged.files.skipped).toEqual([
      { fileKey: "k-fj", fileName: "Q3 Brainstorm", reason: "Skipped: a FigJam board." },
      {
        fileKey: "k-co",
        fileName: "Checkout Screens",
        reason: expect.stringContaining("Run the plugin in that file again"),
      },
    ]);
    expect(merged.note).toContain("files.skipped");
  });

  test("skips a file whose plugin returned a shape it cannot read", () => {
    const merged = mergeSearchResults({
      outcomes: [answered(system, [button("1:1")]), { file: checkout, result: { hits: [] } }],
      skipped: [],
    });
    expect(merged.files.skipped[0]).toMatchObject({
      fileName: "Checkout Screens",
      reason: expect.stringContaining("Rebuild"),
    });
  });

  test("throws, naming every file's reason, when no file answered", () => {
    expect(() =>
      mergeSearchResults({
        outcomes: [{ file: checkout, error: "Request timed out (3 minutes)" }],
        skipped: [
          { fileKey: "k-fj", fileName: "Q3 Brainstorm", reason: "Skipped: a FigJam board." },
        ],
      })
    ).toThrow(/No file could be searched.*Q3 Brainstorm.*FigJam.*Checkout Screens.*timed out/s);
  });

  test("throws the no-plugin error when nothing was connected", () => {
    expect(() => mergeSearchResults({ outcomes: [], skipped: [] })).toThrow(/No plugin connected/);
  });

  test("reports libraryError once and each file's instance error by name", () => {
    const merged = mergeSearchResults({
      outcomes: [
        answered(system, [], { libraryError: "needs a plan", instanceError: "sys broke" }),
        answered(checkout, [], { libraryError: "needs a plan", instanceError: "co broke" }),
      ],
      skipped: [],
    });
    expect(merged.libraryError).toBe("needs a plan");
    expect(merged.instanceErrors).toEqual([
      { fileName: "Acme Design System", message: "sys broke" },
      { fileName: "Checkout Screens", message: "co broke" },
    ]);
    expect(merged.instanceError).toBeUndefined();
  });

  test("keeps the single-file instanceError field for a one-file search", () => {
    const merged = mergeSearchResults({
      outcomes: [answered(system, [], { instanceError: "broke" })],
      skipped: [],
    });
    expect(merged.instanceError).toBe("broke");
    expect(merged.instanceErrors).toBeUndefined();
  });

  test("keeps each scope once and suggests allPages only when it was off", () => {
    const merged = mergeSearchResults({
      outcomes: [answered(system, []), answered(checkout, [])],
      skipped: [],
    });
    expect(merged.searched).toEqual(SCOPES);
    expect(merged.note).toContain("allPages: true");
    const all = mergeSearchResults({
      outcomes: [answered(system, [])],
      skipped: [],
      allPages: true,
    });
    expect(all.note).not.toContain("allPages: true");
  });
});
