import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppIcon,
  ChevronIcon,
  DartsIcon,
  MoonIcon,
  MovedIcon,
  OutlineStackIcon,
  PixelCursorIcon,
  SelectionOutIcon,
  ShapeRelayIcon,
  SunIcon,
} from "./icons";

// The Rising sun icons (Figma "Brand kit: Rising sun"): colours come from the theme, never from
// the markup, so both themes draw them right.

const GLYPHS = {
  PixelCursorIcon,
  MovedIcon,
  SelectionOutIcon,
  OutlineStackIcon,
  ShapeRelayIcon,
  DartsIcon,
};

const paints = (markup: string) =>
  [...markup.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map(([, value]) => value);

describe("chip glyphs", () => {
  for (const [name, Glyph] of Object.entries(GLYPHS)) {
    for (const size of [12, 14]) {
      test(`${name} at ${size} px paints only with currentColor`, () => {
        const markup = renderToStaticMarkup(createElement(Glyph, { size }));
        expect(markup).toContain(`width="${size}"`);
        expect(markup).not.toMatch(/#[0-9a-f]{3,8}/i);
        const used = paints(markup).filter((value) => value !== "none");
        expect(used.length).toBeGreaterThan(0);
        expect(used.every((value) => value === "currentColor")).toBe(true);
      });
    }
  }

  test("ChevronIcon strokes with currentColor in both directions", () => {
    for (const direction of ["up", "down"] as const) {
      const markup = renderToStaticMarkup(createElement(ChevronIcon, { size: 14, direction }));
      expect(paints(markup).filter((value) => value !== "none")).toEqual(["currentColor"]);
    }
  });
});

describe("AppIcon", () => {
  const render = (channel: "stable" | "dev", state: "live" | "offline", size = 16) =>
    renderToStaticMarkup(createElement(AppIcon, { channel, state, size }));

  test("no variant contains a hex colour", () => {
    for (const channel of ["stable", "dev"] as const) {
      for (const state of ["live", "offline"] as const) {
        expect(render(channel, state)).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });

  test("stable live is the rising sun over the horizon", () => {
    const markup = render("stable", "live");
    expect(markup).toContain("var(--sun-rising)");
    expect(markup).toContain("var(--line-horizon)");
    expect(markup).not.toContain("var(--sun-set)");
  });

  test("stable offline is the setting sun", () => {
    const markup = render("stable", "offline");
    expect(markup).toContain("var(--sun-set)");
    expect(markup).not.toContain("var(--sun-rising)");
  });

  test("dev live sits on an ink tile", () => {
    const markup = render("dev", "live");
    expect(markup).toContain("var(--surface-ink)");
    expect(markup).toContain("var(--sun-on-ink)");
  });

  test("dev offline keeps the tile and sets the sun", () => {
    const markup = render("dev", "offline");
    expect(markup).toContain("var(--surface-ink)");
    expect(markup).toContain("var(--sun-set)");
  });

  test("scales one 16 px drawing to the size asked for", () => {
    const markup = render("stable", "live", 20);
    expect(markup).toContain('width="20"');
    expect(markup).toContain('viewBox="0 0 16 16"');
  });
});

describe("theme switch glyphs", () => {
  for (const [name, Glyph] of Object.entries({ SunIcon, MoonIcon })) {
    test(`${name} is a 10 px glyph painted with currentColor`, () => {
      const markup = renderToStaticMarkup(createElement(Glyph, { size: 10 }));
      expect(markup).toContain('viewBox="0 0 10 10"');
      expect(markup).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(paints(markup).filter((value) => value !== "none")).not.toHaveLength(0);
      expect(paints(markup).every((value) => value === "none" || value === "currentColor")).toBe(
        true
      );
    });
  }
});
