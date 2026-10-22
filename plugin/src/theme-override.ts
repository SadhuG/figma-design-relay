// A dev build's theme override, shared by the main thread (which stores it in figma.clientStorage)
// and the panel (which applies it). Free of the figma global so both can import it and Bun can
// test it. The stable build never writes one.

/** `null` follows Figma's theme. */
export type ThemeOverride = "light" | "dark" | null;

export const THEME_OVERRIDE_KEY = "theme-override";

/** The stored value, read defensively: anything but light or dark means follow Figma. */
export function parseThemeOverride(value: unknown): ThemeOverride {
  return value === "light" || value === "dark" ? value : null;
}
