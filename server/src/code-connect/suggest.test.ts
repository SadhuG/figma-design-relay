import { describe, expect, test } from "bun:test";
import { scoreCandidates } from "./suggest.js";

const exports = [
  { name: "Button", source: "src/ui/Button.tsx" },
  { name: "ButtonGroup", source: "src/ui/ButtonGroup.tsx" },
  { name: "Card", source: "src/ui/Card.tsx" },
  { name: "IconButton", source: "src/ui/IconButton.tsx" },
];

describe("scoreCandidates", () => {
  test("ranks an exact name match first", () => {
    expect(scoreCandidates("Button", exports)[0].component).toBe("Button");
  });

  test("matches a Figma variant path against its component name", () => {
    expect(scoreCandidates("Button/Primary", exports)[0].component).toBe("Button");
  });

  test("is case and separator insensitive", () => {
    expect(scoreCandidates("icon button", exports)[0].component).toBe("IconButton");
  });

  test("explains why each candidate was proposed", () => {
    expect(scoreCandidates("Button", exports)[0].evidence).toMatch(/exact/i);
  });

  test("returns nothing rather than a bad guess", () => {
    expect(scoreCandidates("Zzzz Widget", exports)).toEqual([]);
  });
});

describe("findExportedComponents", () => {
  test("finds capitalised exports and skips Code Connect, tests and node_modules", async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { findExportedComponents } = await import("./suggest.js");

    const root = await mkdtemp(path.join(tmpdir(), "cc-exports-"));
    await mkdir(path.join(root, "ui"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "lib"), { recursive: true });
    await writeFile(
      path.join(root, "ui", "Button.tsx"),
      "export const Button = () => null;\nexport function useButton() {}\nexport default function Card() {}"
    );
    await writeFile(path.join(root, "ui", "Button.figma.tsx"), "export const Mapped = 1;");
    await writeFile(path.join(root, "ui", "Button.test.tsx"), "export const Tested = 1;");
    await writeFile(path.join(root, "node_modules", "lib", "x.ts"), "export const Vendor = 1;");

    const found = await findExportedComponents(root);
    await rm(root, { recursive: true, force: true });

    expect(found).toEqual([
      { name: "Button", source: "ui/Button.tsx" },
      { name: "Card", source: "ui/Button.tsx" },
    ]);
  });
});
