import { describe, expect, test } from "bun:test";
import type { ConnectedFile } from "../types.js";
import { selectSearchFiles } from "./select-files.js";

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
const board: ConnectedFile = { fileKey: "k-fj", fileName: "Q3 Brainstorm", editorType: "figjam" };
const deck: ConnectedFile = { fileKey: "k-sl", fileName: "Pitch", editorType: "slides" };
const devMode: ConnectedFile = { fileKey: "k-dev", fileName: "Handoff", editorType: "dev" };
const legacy: ConnectedFile = { fileKey: "k-old", fileName: "Old Plugin File" };

const keys = (files: ConnectedFile[]) => files.map((file) => file.fileKey);

describe("selectSearchFiles by default", () => {
  test("selects every design file and skips FigJam and Slides with a reason", () => {
    const { selected, skipped } = selectSearchFiles([system, board, checkout, deck], {});
    expect(keys(selected)).toEqual(["k-sys", "k-co"]);
    expect(skipped).toEqual([
      {
        fileKey: "k-fj",
        fileName: "Q3 Brainstorm",
        reason: expect.stringContaining("FigJam board"),
      },
      { fileKey: "k-sl", fileName: "Pitch", reason: expect.stringContaining("Slides deck") },
    ]);
  });

  test("searches Dev Mode files and files whose plugin reports no editor", () => {
    expect(keys(selectSearchFiles([devMode, legacy], {}).selected)).toEqual(["k-dev", "k-old"]);
  });

  test("selects nothing and skips nothing when nothing is connected", () => {
    expect(selectSearchFiles([], {})).toEqual({ selected: [], skipped: [] });
  });
});

describe("selectSearchFiles with files", () => {
  test("matches names case-insensitively after trimming, and fileKeys exactly", () => {
    const { selected } = selectSearchFiles([system, checkout], {
      files: ["  acme design SYSTEM "],
    });
    expect(keys(selected)).toEqual(["k-sys"]);
    expect(keys(selectSearchFiles([system, checkout], { files: ["k-co"] }).selected)).toEqual([
      "k-co",
    ]);
  });

  test("selects every file sharing a name", () => {
    const a: ConnectedFile = { fileKey: "u1", fileName: "Untitled", editorType: "figma" };
    const b: ConnectedFile = { fileKey: "u2", fileName: "Untitled", editorType: "figma" };
    expect(keys(selectSearchFiles([a, b, system], { files: ["untitled"] }).selected)).toEqual([
      "u1",
      "u2",
    ]);
  });

  test("searches a file once when it is named twice", () => {
    const { selected } = selectSearchFiles([system], { files: ["Acme Design System", "k-sys"] });
    expect(keys(selected)).toEqual(["k-sys"]);
  });

  test("reports a name that is not open, listing the open files", () => {
    const { selected, skipped } = selectSearchFiles([system, checkout], { files: ["Acme DS v2"] });
    expect(selected).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].fileName).toBe("Acme DS v2");
    expect(skipped[0].reason).toContain("Not open");
    expect(skipped[0].reason).toContain('"Acme Design System", "Checkout Screens"');
  });

  test("still skips a named FigJam board", () => {
    const { selected, skipped } = selectSearchFiles([board], { files: ["Q3 Brainstorm"] });
    expect(selected).toEqual([]);
    expect(skipped[0].reason).toContain("FigJam board");
  });
});

describe("selectSearchFiles with fileKey", () => {
  test("selects exactly that file, whatever its editor", () => {
    expect(keys(selectSearchFiles([system, board], { fileKey: "k-fj" }).selected)).toEqual([
      "k-fj",
    ]);
  });

  test("reports an unknown fileKey with the open files", () => {
    const { selected, skipped } = selectSearchFiles([system], { fileKey: "nope" });
    expect(selected).toEqual([]);
    expect(skipped[0].reason).toContain('No plugin connected for fileKey "nope"');
    expect(skipped[0].reason).toContain('"Acme Design System"');
  });
});
