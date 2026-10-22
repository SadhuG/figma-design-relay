// The panel's theme rules, kept free of React so they can be unit-tested. Figma opens the UI with
// `themeColors: true` (code.ts), which puts `figma-light` or `figma-dark` on the iframe's <html> and
// changes it when the user switches Figma's theme. CSS picks the colours from that class on its
// own (index.css); these rules are for what the panel says and does about it.

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
