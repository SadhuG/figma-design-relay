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

/** The same roles, dark values. */
const DARK: Record<string, string> = {
  "surface-paper": "#121110",
  "surface-well": "#1c1a17",
  "surface-raised": "#24211d",
  "surface-ink": "#f7f4ee",
  "text-primary": "#f7f4ee",
  "text-secondary": "#a39c8f",
  "text-on-ink": "#1a1a1a",
  "text-on-sun": "#f7f4ee",
  "sun-rising": "#d0103a",
  "sun-set": "#8a8376",
  "sun-on-ink": "#1a1a1a",
  "line-hairline": "#38342e",
  "line-horizon": "#f7f4ee",
  "status-connected": "#82ad66",
  "status-error": "#e8475f",
};

/** Dark when Figma is dark and the dev override doesn't say light, or when it says dark. */
const DARK_SELECTOR = ':root.figma-dark:not([data-theme="light"]), :root[data-theme="dark"]';

/** The declarations of the rule whose selector list, whitespace collapsed, is `selector`. */
const ruleBody = (css: string, selector: string): string => {
  for (const [, selectors, body] of css.matchAll(/([^{}]+){([^}]*)}/g)) {
    const list = selectors
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (list === selector) return body;
  }
  return "";
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
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<=^|})\s*:root[^{]*{[^}]*}/g, "");

const COLOUR_PROPERTY =
  /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|box-shadow|caret-color)$/;

/** What a colour declaration may hold besides a role: sizes, styles and keywords with no hue. */
const NOT_A_COLOUR = new RegExp(
  String.raw`var\(--(${Object.keys(LIGHT).join("|")})\)|${FOCUS_RING}|\b(transparent|currentColor|none|inherit|solid)\b|-?\d*\.?\d+(px|%)?`,
  "gi"
);

/** Colour declarations outside :root that name anything but a role. */
const colourProblems = (css: string): string[] =>
  [...outsideRoot(css).matchAll(/([a-z-]+):\s*([^;{}]+);/g)]
    .filter(([, property]) => COLOUR_PROPERTY.test(property))
    .map(([, property, value]) => [property, value.trim()] as const)
    .filter(([, value]) => value.replace(NOT_A_COLOUR, "").trim() !== "")
    .map(([property, value]) => `${property}: ${value}`);

describe("index.css", () => {
  const css = read("index.css");

  test(":root defines every light role with the overview's value", () => {
    const root = customProperties(block(css, ":root"));
    for (const [role, value] of Object.entries(LIGHT)) expect(root[role]).toBe(value);
  });

  test("the dark block defines every role with the overview's dark value", () => {
    const dark = customProperties(ruleBody(css, DARK_SELECTOR));
    expect(Object.keys(dark).sort()).toEqual(Object.keys(DARK).sort());
    for (const [role, value] of Object.entries(DARK)) expect(dark[role]).toBe(value);
  });

  test("the dark selector is exactly the overview's", () => {
    expect(ruleBody(css, DARK_SELECTOR)).not.toBe("");
  });

  test("uses only role variables", () => {
    const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map(([, name]) => name));
    const allowed = new Set([...Object.keys(LIGHT), "font-ui", "font-mono"]);
    expect([...used].filter((name) => !allowed.has(name))).toEqual([]);
    const literals = outsideRoot(css).match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(literals.filter((literal) => literal.toLowerCase() !== FOCUS_RING)).toEqual([]);
    expect(colourProblems(css)).toEqual([]);
  });

  test("the colour check catches named colours and other colour functions", () => {
    expect(
      colourProblems(".a { color: red; } .b { background: hsl(0 0% 0%); } .c { fill: none; }")
    ).toEqual(["color: red", "background: hsl(0 0% 0%)"]);
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

describe("the dev Theme switch", () => {
  const css = read("index.css");
  const declarations = (selector: string) =>
    Object.fromEntries(
      [...ruleBody(css, selector).matchAll(/([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [
        name,
        value.trim(),
      ])
    );

  test("the switch is 32 × 18 with a 14 px knob, as Theme toggle's Small variants", () => {
    expect(declarations(".theme-switch")).toMatchObject({ width: "32px", height: "18px" });
    expect(declarations(".theme-switch-knob")).toMatchObject({ width: "14px", height: "14px" });
  });

  test("the knob travels 14 px to the right for dark", () => {
    const light = Number.parseFloat(declarations(".theme-switch-knob").left);
    const dark = Number.parseFloat(
      declarations('.theme-switch[aria-checked="true"] .theme-switch-knob').left
    );
    expect(dark - light).toBe(14);
  });
});
