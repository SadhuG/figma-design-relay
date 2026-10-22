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

type Read = (key: string) => Promise<unknown>;
type Write = (key: string, value: unknown) => Promise<void>;

/**
 * The override the main thread starts with. A stable build (`devBuild` false) never reads the
 * key, so it can't pick up a value from anywhere; a failed read follows Figma.
 */
export async function loadThemeOverride(devBuild: boolean, read: Read): Promise<ThemeOverride> {
  if (!devBuild) return null;
  try {
    return parseThemeOverride(await read(THEME_OVERRIDE_KEY));
  } catch {
    return null;
  }
}

/**
 * Keeps the panel's new override and returns it, parsed. A stable build stores nothing and stays
 * on Figma's theme. Storing is best-effort: the panel has already switched.
 */
export async function saveThemeOverride(
  devBuild: boolean,
  value: unknown,
  write: Write
): Promise<ThemeOverride> {
  if (!devBuild) return null;
  const override = parseThemeOverride(value);
  try {
    await write(THEME_OVERRIDE_KEY, override);
  } catch {
    // Best-effort, like the collapsed state.
  }
  return override;
}
