import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SerializedNode } from "../codegen/tokens.js";
import { buildCodeConnectIndex, mappingsForTree } from "./index.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cc-index-"));
  await mkdir(path.join(root, "ui"), { recursive: true });
  await writeFile(
    path.join(root, "ui", "Button.figma.tsx"),
    'figma.connect(Button, "https://figma.com/design/AbC/DS?node-id=1-2", { props: { label: figma.string("Label") } });'
  );
  await writeFile(
    path.join(root, "ui", "Card.figma.tsx"),
    'figma.connect(Card, "https://figma.com/design/Zed/Other?node-id=1-2");\n' +
      'figma.connect(Badge, "https://figma.com/design/Zed/Other?node-id=5-6");'
  );
  await writeFile(path.join(root, "ui", "Broken.figma.ts"), "figma.connect(Broken, notAUrl);");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("buildCodeConnectIndex", () => {
  test("collects every mapping it could read", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.mappings).toHaveLength(3);
  });

  test("reports the file it could not read", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.errors[0]).toContain("Broken.figma.ts");
  });

  test("disambiguates the same node id across files by file key", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.lookup("1:2", "AbC")?.component).toBe("Button");
    expect(index.lookup("1:2", "Zed")?.component).toBe("Card");
  });

  test("falls back to a unique node-id match when no file key is given", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.lookup("5:6")?.component).toBe("Badge");
    expect(index.lookup("9:9")).toBeUndefined();
  });

  test("never matches another file's mapping when the file key is known", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.lookup("5:6", "AbC")).toBeUndefined();
  });

  test("counts the files it scanned", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.filesScanned).toBe(3);
  });
});

describe("mappingsForTree", () => {
  const tree = {
    id: "10:1",
    name: "Screen",
    type: "FRAME",
    children: [
      {
        id: "10:2",
        name: "Primary",
        type: "INSTANCE",
        design: { mainComponent: { id: "1:9", name: "Size=M", setId: "1:2", setName: "Button" } },
      },
      {
        id: "10:3",
        name: "Badge",
        type: "INSTANCE",
        design: { mainComponent: { id: "5:6", name: "Badge" } },
      },
      {
        id: "10:4",
        name: "Other",
        type: "INSTANCE",
        design: { mainComponent: { id: "7:7", name: "Other" } },
      },
    ],
  } as unknown as SerializedNode;

  test("maps an instance through its component set", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(mappingsForTree(tree, index, "AbC")["10:2"]?.component).toBe("Button");
  });

  test("maps an instance through its main component", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(mappingsForTree(tree, index, "Zed")["10:3"]?.component).toBe("Badge");
  });

  test("leaves unmapped instances out", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(Object.keys(mappingsForTree(tree, index, "AbC"))).toEqual(["10:2"]);
  });

  test("maps a component node by its own id", async () => {
    const index = await buildCodeConnectIndex(root);
    const component = { id: "1:2", name: "Button", type: "COMPONENT_SET" } as SerializedNode;
    expect(mappingsForTree(component, index, "AbC")["1:2"]?.component).toBe("Button");
  });
});
