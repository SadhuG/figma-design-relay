import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverCodeConnectFiles } from "./discover.js";

let root: string;
let outside: string;
let linked = false;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cc-"));
  outside = await mkdtemp(path.join(tmpdir(), "cc-outside-"));
  await mkdir(path.join(root, "src", "ui"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, "src", "ui", "Button.figma.tsx"), "");
  await writeFile(path.join(root, "src", "ui", "Card.figma.ts"), "");
  await writeFile(path.join(root, "src", "ui", "Button.tsx"), "");
  await writeFile(path.join(root, "node_modules", "pkg", "Thing.figma.ts"), "");
  await writeFile(path.join(root, ".git", "Hook.figma.ts"), "");
  await writeFile(path.join(outside, "Secret.figma.ts"), "");
  // Creating a symlink needs a privilege Windows does not grant by default.
  try {
    await symlink(
      path.join(outside, "Secret.figma.ts"),
      path.join(root, "src", "ui", "Escape.figma.ts")
    );
    linked = true;
  } catch {
    linked = false;
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("discoverCodeConnectFiles", () => {
  test("finds every Code Connect file under the root", async () => {
    const found = await discoverCodeConnectFiles(root);
    expect(found).toContain("src/ui/Button.figma.tsx");
    expect(found).toContain("src/ui/Card.figma.ts");
  });

  test("ignores ordinary sources", async () => {
    expect(await discoverCodeConnectFiles(root)).not.toContain("src/ui/Button.tsx");
  });

  test("does not descend into node_modules or .git", async () => {
    const found = await discoverCodeConnectFiles(root);
    expect(found.some((file) => file.includes("node_modules"))).toBe(false);
    expect(found.some((file) => file.includes(".git"))).toBe(false);
  });

  test("skips a link that resolves outside the root", async () => {
    if (!linked) return;
    expect(await discoverCodeConnectFiles(root)).not.toContain("src/ui/Escape.figma.ts");
  });

  test("returns POSIX paths on every platform", async () => {
    const found = await discoverCodeConnectFiles(root);
    expect(found.every((file) => !file.includes("\\"))).toBe(true);
  });

  test("returns an empty list for a directory with none", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "cc-empty-"));
    expect(await discoverCodeConnectFiles(empty)).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });
});
