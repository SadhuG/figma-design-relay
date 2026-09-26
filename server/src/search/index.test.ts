import { describe, expect, test } from "bun:test";
import type { BridgeResponse, ConnectedFile } from "../types.js";
import { searchAcrossFiles, type SearchIo } from "./index.js";

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

const ok = (data: unknown): BridgeResponse => ({
  type: "search_design_system",
  requestId: "r",
  data,
});
const empty = { results: [], searched: ["components and component instances on the current page"] };

const stub = (files: ConnectedFile[], reply: (fileKey: string) => Promise<BridgeResponse>) => {
  const sent: Array<{ fileKey: string; params: Record<string, unknown> }> = [];
  const io: SearchIo = {
    listFiles: async () => files,
    send: (params, fileKey) => {
      sent.push({ fileKey, params });
      return reply(fileKey);
    },
  };
  return { io, sent };
};

describe("searchAcrossFiles", () => {
  test("sends today's single-file request to every selected file", async () => {
    const { io, sent } = stub([system, checkout, board], async () => ok(empty));
    const result = await searchAcrossFiles(io, { query: "button", limit: 5, allPages: true });
    expect(sent).toEqual([
      { fileKey: "k-sys", params: { query: "button", limit: 5, allPages: true } },
      { fileKey: "k-co", params: { query: "button", limit: 5, allPages: true } },
    ]);
    expect(result.files.skipped.map((file) => file.fileName)).toEqual(["Q3 Brainstorm"]);
  });

  test("searches only the files named", async () => {
    const { io, sent } = stub([system, checkout], async () => ok(empty));
    await searchAcrossFiles(io, { query: "button", files: ["acme design system"] });
    expect(sent.map((call) => call.fileKey)).toEqual(["k-sys"]);
  });

  test("refuses fileKey and files together, before sending anything", async () => {
    const { io, sent } = stub([system], async () => ok(empty));
    await expect(
      searchAcrossFiles(io, { query: "b", fileKey: "k-sys", files: ["x"] })
    ).rejects.toThrow(/fileKey or files, not both/);
    expect(sent).toEqual([]);
  });

  test("turns a rejected request and a plugin error into skipped files", async () => {
    const third: ConnectedFile = { ...checkout, fileKey: "k-3", fileName: "Third" };
    const { io } = stub([system, checkout, third], async (fileKey) => {
      if (fileKey === "k-co") throw new Error("Plugin disconnected: Checkout Screens (k-co)");
      if (fileKey === "k-3") return { type: "search_design_system", requestId: "r", error: "boom" };
      return ok(empty);
    });
    const result = await searchAcrossFiles(io, { query: "button" });
    expect(result.files.searched.map((file) => file.fileName)).toEqual(["Acme Design System"]);
    expect(result.files.skipped.map((file) => [file.fileName, file.reason])).toEqual([
      ["Checkout Screens", expect.stringContaining("Run the plugin in that file again")],
      ["Third", "boom"],
    ]);
  });

  test("with only a FigJam board open, says it was skipped as one", async () => {
    const { io } = stub([board], async () => ok(empty));
    await expect(searchAcrossFiles(io, { query: "button" })).rejects.toThrow(
      /Q3 Brainstorm.*FigJam board/
    );
  });
});
