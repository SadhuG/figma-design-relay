import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportAssets, findExportableNodes } from "./assets.js";
import type { SerializedNode } from "./codegen/tokens.js";

const tree = {
  id: "1:1",
  name: "Screen",
  type: "FRAME",
  children: [
    { id: "1:2", name: "icon/search", type: "VECTOR" },
    {
      id: "1:3",
      name: "Hero",
      type: "RECTANGLE",
      styles: { fills: [{ type: "IMAGE", imageHash: "abc" }] },
    },
    { id: "1:4", name: "Title", type: "TEXT" },
    {
      id: "1:5",
      name: "Logo",
      type: "GROUP",
      children: [{ id: "1:6", name: "path", type: "VECTOR" }],
    },
  ],
} as unknown as SerializedNode;

describe("findExportableNodes", () => {
  test("finds vectors and image-filled nodes", () => {
    expect(findExportableNodes(tree)).toContain("1:2");
    expect(findExportableNodes(tree)).toContain("1:3");
  });

  test("skips text", () => {
    expect(findExportableNodes(tree)).not.toContain("1:4");
  });

  test("exports a vector group whole rather than its paths", () => {
    const ids = findExportableNodes(tree);
    expect(ids).toContain("1:5");
    expect(ids).not.toContain("1:6");
  });

  // Icons in a design system are instances of an icon component, so the same
  // rule has to hold for an instance (or the component itself) whose children
  // are all vectors — otherwise a logo comes out as a pile of `Vector` files.
  test("exports an icon instance whole rather than its paths", () => {
    const ids = findExportableNodes({
      id: "3:1",
      name: "Button",
      type: "INSTANCE",
      children: [
        { id: "3:2", name: "Label", type: "TEXT" },
        {
          id: "3:3",
          name: "google-logo-color",
          type: "INSTANCE",
          children: [
            { id: "3:4", name: "Vector", type: "VECTOR" },
            { id: "3:5", name: "Vector", type: "VECTOR" },
          ],
        },
      ],
    } as unknown as SerializedNode);
    expect(ids).toEqual(["3:3"]);
  });

  // A real icon often mixes a vector with a rectangle or ellipse (a badge dot,
  // a background plate). It is still one icon, as long as something in it is a
  // vector — a frame of nothing but rectangles is a layout, not an icon.
  test("exports an icon that mixes vectors and primitive shapes whole", () => {
    const ids = findExportableNodes({
      id: "4:1",
      name: "icon/bell-badge",
      type: "INSTANCE",
      children: [
        { id: "4:2", name: "bell", type: "VECTOR" },
        { id: "4:3", name: "badge", type: "ELLIPSE" },
      ],
    } as unknown as SerializedNode);
    expect(ids).toEqual(["4:1"]);
  });

  test("does not treat a frame of plain rectangles as an icon", () => {
    const ids = findExportableNodes({
      id: "5:1",
      name: "Grid",
      type: "FRAME",
      children: [
        { id: "5:2", name: "cell", type: "RECTANGLE" },
        { id: "5:3", name: "cell", type: "RECTANGLE" },
      ],
    } as unknown as SerializedNode);
    expect(ids).toEqual([]);
  });

  test("returns an empty list for a tree with nothing to export", () => {
    expect(
      findExportableNodes({ id: "2:1", name: "Plain", type: "FRAME" } as SerializedNode)
    ).toEqual([]);
  });
});

describe("exportAssets", () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
  const sender = {
    sendWithParams: async (_tool: string, nodeIds?: string[]) => ({
      type: "get_screenshot",
      requestId: "r1",
      data: {
        exports: (nodeIds ?? []).map((nodeId) => ({
          nodeId,
          nodeName: "icon/search",
          base64: svg,
        })),
      },
    }),
  };

  let workspace: string;
  let previousCwd: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    workspace = await mkdtemp(path.join(tmpdir(), "relay-assets-"));
    process.chdir(workspace);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
    await rm(path.join(workspace, "..", "relay-leak"), { recursive: true, force: true });
  });

  test("writes each asset under the directory and reports a workspace-relative path", async () => {
    const records = await exportAssets(sender, ["1:2"], "assets");
    expect(records).toEqual([
      {
        nodeId: "1:2",
        nodeName: "icon/search",
        file: "assets/icon-search-1-2.svg",
        format: "SVG",
        bytes: Buffer.from(svg, "base64").length,
      },
    ]);
    expect(await stat(path.join(workspace, "assets", "icon-search-1-2.svg"))).toBeTruthy();
  });

  // Ids differ only in where the colon sits; stripping it would map both to
  // the same file and the second write would silently replace the first.
  test("keeps distinct node ids distinct in file names", async () => {
    const records = await exportAssets(sender, ["1:234", "12:34"], "assets");
    expect(records.map((r) => r.file)).toEqual([
      "assets/icon-search-1-234.svg",
      "assets/icon-search-12-34.svg",
    ]);
  });

  // A link inside the workspace that points outside passes the lexical check;
  // mkdir would then follow it and create directories out there before the
  // real-path check refuses. The existing part of the path has to be resolved
  // first. (A junction is the privilege-free directory link on Windows.)
  test("refuses a path through a link that points outside, without creating anything", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "relay-outside-"));
    try {
      await symlink(outside, path.join(workspace, "link"), "junction");
      await expect(exportAssets(sender, ["1:2"], "link/assets")).rejects.toThrow(
        /outside the MCP server working directory/
      );
      await expect(stat(path.join(outside, "assets"))).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  // The guard has to run before anything touches the filesystem: refusing
  // after mkdir still leaves an empty directory outside the workspace.
  test("refuses a directory outside the workspace without creating it", async () => {
    await expect(exportAssets(sender, ["1:2"], "../relay-leak")).rejects.toThrow(
      /outside the MCP server working directory/
    );
    await expect(stat(path.join(workspace, "..", "relay-leak"))).rejects.toThrow();
  });
});

describe("findExportableNodes containers", () => {
  // A hero frame with a background image is a layout, not an asset: exporting
  // it whole bakes its headline into the SVG and hides the icons inside it.
  test("walks into an image-filled container instead of exporting it", () => {
    const ids = findExportableNodes({
      id: "6:1",
      name: "Hero",
      type: "FRAME",
      styles: { fills: [{ type: "IMAGE", imageHash: "bg" }] },
      children: [
        { id: "6:2", name: "Headline", type: "TEXT" },
        { id: "6:3", name: "icon/play", type: "VECTOR" },
      ],
    } as unknown as SerializedNode);
    expect(ids).toEqual(["6:3"]);
  });

  test("still exports an image-filled leaf", () => {
    const ids = findExportableNodes({
      id: "6:4",
      name: "Photo",
      type: "RECTANGLE",
      styles: { fills: [{ type: "IMAGE", imageHash: "p" }] },
    } as unknown as SerializedNode);
    expect(ids).toEqual(["6:4"]);
  });

  // Icons are frequently a group of paths beside a lone vector; the group is
  // part of the icon, not a reason to shatter it.
  test("treats nested vector groups as part of one icon", () => {
    const ids = findExportableNodes({
      id: "7:1",
      name: "icon/layers",
      type: "INSTANCE",
      children: [
        { id: "7:2", name: "base", type: "VECTOR" },
        {
          id: "7:3",
          name: "stack",
          type: "GROUP",
          children: [
            { id: "7:4", name: "a", type: "VECTOR" },
            { id: "7:5", name: "b", type: "ELLIPSE" },
          ],
        },
      ],
    } as unknown as SerializedNode);
    expect(ids).toEqual(["7:1"]);
  });
});
