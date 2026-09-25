export interface FigmaTarget {
  fileKey: string;
  /** Colon form, e.g. `1:2` — the form every other tool in this server uses. */
  nodeId: string;
}

/**
 * Extracts the file key and node id from a Figma design URL.
 *
 * Figma writes node ids hyphenated in URLs (`node-id=1-2`) and colon-separated
 * everywhere else (`1:2`). Normalising here is what stops a lookup from
 * silently never matching.
 * @param url - A Figma design or file URL.
 * @returns The target, or null when the URL is not a Figma node URL.
 */
export const parseFigmaUrl = (url: string): FigmaTarget | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!/(^|\.)figma\.com$/.test(parsed.hostname)) return null;

  const match = parsed.pathname.match(/^\/(?:design|file|board|slides)\/([A-Za-z0-9]+)/);
  if (!match) return null;

  const rawNodeId = parsed.searchParams.get("node-id");
  if (!rawNodeId) return null;

  const nodeId = rawNodeId.replace(/-/g, ":");
  if (!/^\d+:\d+$/.test(nodeId)) return null;

  return { fileKey: match[1], nodeId };
};
