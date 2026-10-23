// The plugin window's size. The main thread owns it (figma.ui.resize), but the numbers come from
// the panel's layout in src/ui/index.css: keep the two in step. Every state fits the open height,
// so the window never jumps.

export const UI_WIDTH = 320;

/** Just the status bar: the collapsed window, in both builds. */
export const UI_COLLAPSED_HEIGHT = 36;

/**
 * The open window: rows 81 + spacer 4 + footer 36 = 121. A dev build shows a Theme row as well
 * (18 px and a 6 px gap), so it opens at 145.
 */
export function uiExpandedHeight(devBuild: boolean): number {
  return devBuild ? 145 : 121;
}
