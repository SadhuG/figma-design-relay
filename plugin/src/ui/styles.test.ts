import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The panel's stylesheets read as text: the rules here are about what the CSS says, which the
// build can't check (Vite inlines whatever it is given).

const read = (name: string): string => {
  const path = fileURLToPath(new URL(`./${name}`, import.meta.url));
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

const faces = (css: string) =>
  [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => ({
    family: /font-family:\s*"([^"]+)"/.exec(body)?.[1],
    weight: /font-weight:\s*(\d+)/.exec(body)?.[1],
    src: /src:\s*([^;]+);/.exec(body)?.[1].trim(),
  }));

describe("fonts.css", () => {
  test("declares exactly four woff2 faces", () => {
    const declared = faces(read("fonts.css"));
    expect(declared.map(({ family, weight }) => `${family} ${weight}`).sort()).toEqual([
      "M PLUS 1 Code 400",
      "M PLUS 1 Code 500",
      "Zen Kaku Gothic New 400",
      "Zen Kaku Gothic New 500",
    ]);
    for (const { weight, src } of declared) {
      // One source each, the Latin subset only: the package's own CSS adds a .woff fallback that
      // would double the inlined bundle.
      expect(src).toMatch(
        new RegExp(String.raw`^url\("[^"]+-latin-${weight}-normal\.woff2"\) format\("woff2"\)$`)
      );
    }
  });
});
