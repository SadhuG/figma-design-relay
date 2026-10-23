// The panel's theme rules, kept free of React so they can be unit-tested. Figma opens the UI with
// `themeColors: true` (code.ts), which puts `figma-light` or `figma-dark` on the iframe's <html> and
// changes it when the user switches Figma's theme. CSS picks the colours from that class on its
// own (index.css); these rules are for what the panel says and does about it.

import type { ThemeOverride } from "../theme-override";

export type Theme = "light" | "dark";

/** Figma's theme from the <html> class list; light when Figma set none. */
export function figmaTheme(className: string): Theme {
  return className.split(/\s+/).includes("figma-dark") ? "dark" : "light";
}

/**
 * Calls `onChange` with Figma's theme now and again each time Figma changes it. Returns the
 * unsubscribe. `Observer` is injectable so the rule can run under Bun, which has no DOM.
 */
export function watchFigmaTheme(
  root: HTMLElement,
  onChange: (theme: Theme) => void,
  Observer: typeof MutationObserver = MutationObserver
): () => void {
  onChange(figmaTheme(root.className));
  const observer = new Observer(() => onChange(figmaTheme(root.className)));
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

// A dev build's Theme row (App.tsx) can override Figma's theme for testing designs. These rules
// decide what it shows and what a click does; the stable build never calls them.

/** The theme the panel shows: the override if there is one, else Figma's. */
export function resolveTheme(figma: Theme, override: ThemeOverride): Theme {
  return override ?? figma;
}

/**
 * The override after a click on the switch. The click flips the theme the panel shows; landing on
 * Figma's own theme follows Figma again, so there is no separate reset.
 */
export function nextOverride(figma: Theme, override: ThemeOverride): ThemeOverride {
  const next: Theme = resolveTheme(figma, override) === "dark" ? "light" : "dark";
  return next === figma ? null : next;
}

/** "Dark · Figma" while following, "Dark · override" while overriding. */
export function themeRowText(figma: Theme, override: ThemeOverride): string {
  const theme = resolveTheme(figma, override);
  return `${theme === "dark" ? "Dark" : "Light"} · ${override ? "override" : "Figma"}`;
}
