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
    // Prettier wraps a long src onto two lines.
    src: /src:\s*([^;]+);/.exec(body)?.[1].replace(/\s+/g, " ").trim(),
  }));

/** The Rising sun roles, light values: docs/superpowers/plans/2026-10-23-panel-theme/00-overview.md. */
const LIGHT: Record<string, string> = {
  "surface-paper": "#f7f4ee",
  "surface-well": "#ede7db",
  "surface-raised": "#ffffff",
  "surface-ink": "#1a1a1a",
  "text-primary": "#1a1a1a",
  "text-secondary": "#635c4e",
  "text-on-ink": "#f7f4ee",
  "text-on-sun": "#f7f4ee",
  "sun-rising": "#bc002d",
  "sun-set": "#7a7364",
  "sun-on-ink": "#f7f4ee",
  "line-hairline": "#dcd4c4",
  "line-horizon": "#1a1a1a",
  "status-connected": "#446c33",
  "status-error": "#bc002d",
};

/** Figma's own focus ring, not a brand colour. */
const FOCUS_RING = "#0d99ff";

/** The declarations of the rule whose selector is exactly `selector`. */
const block = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
};

const customProperties = (body: string): Record<string, string> =>
  Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.replace(/\s+/g, " ").trim(),
    ])
  );

/** Every rule but the ones on :root, where the role values live. */
const outsideRoot = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|})\s*:root[^{]*{[^}]*}/g, "$1");

describe("index.css", () => {
  const css = read("index.css");

  test(":root defines every light role with the overview's value", () => {
    const root = customProperties(block(css, ":root"));
    for (const [role, value] of Object.entries(LIGHT)) expect(root[role]).toBe(value);
  });

  test("uses only role variables", () => {
    const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map(([, name]) => name));
    const allowed = new Set([...Object.keys(LIGHT), "font-ui", "font-mono"]);
    expect([...used].filter((name) => !allowed.has(name))).toEqual([]);
    const literals = outsideRoot(css).match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(literals.filter((literal) => literal.toLowerCase() !== FOCUS_RING)).toEqual([]);
  });

  test("every font stack ends in a system fallback", () => {
    const root = customProperties(block(css, ":root"));
    expect(root["font-ui"]).toMatch(/^"Zen Kaku Gothic New", .*sans-serif$/);
    expect(root["font-mono"]).toMatch(/^"M PLUS 1 Code", .*monospace$/);
    const families = [...css.matchAll(/font-family:\s*([^;]+);/g)].map(([, value]) => value.trim());
    for (const family of families) {
      expect(family).toMatch(/^var\(--font-(ui|mono)\)$|(sans-serif|monospace)$/);
    }
  });
});

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
