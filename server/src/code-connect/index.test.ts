import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCodeConnectIndex } from "./index.js";

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
