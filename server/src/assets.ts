import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SerializedNode } from "./codegen/tokens.js";
import type { ScreenshotSender } from "./tools.js";

export interface AssetRecord {
  nodeId: string;
  nodeName: string;
  /** Path relative to the MCP server's working directory. */
  file: string;
  format: "SVG" | "PNG";
  bytes: number;
}

const VECTOR_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);

/**
 * Containers that count as one icon when everything inside them is a vector.
 * INSTANCE and COMPONENT are here because that is how icons actually appear in
 * a design system: `google-logo-color` is an instance of an icon component.
 */
const ICON_CONTAINER_TYPES = new Set(["GROUP", "FRAME", "INSTANCE", "COMPONENT"]);

/**
 * Primitive shapes that may sit inside an icon beside its vectors — a badge
 * dot, a background plate. They never make a container an icon on their own.
 */
const ICON_SHAPE_TYPES = new Set(["RECTANGLE", "ELLIPSE"]);

const hasImageFill = (node: SerializedNode): boolean => {
  const fills = (node.styles as { fills?: Array<{ type?: string }> } | undefined)?.fills;
  return Array.isArray(fills) && fills.some((fill) => fill.type === "IMAGE");
};

/**
 * Finds the nodes worth exporting as files.
 *
 * A vector group is exported whole — descending into its paths would produce a
 * pile of fragments no agent can reassemble — so the walk stops at the first
 * exportable ancestor.
 * @param root - The serialized root.
 * @returns Node ids, in document order.
 */
export const findExportableNodes = (root: SerializedNode): string[] => {
  const ids: string[] = [];

  const walk = (node: SerializedNode): void => {
    const children = node.children ?? [];
    const isVectorGroup =
      ICON_CONTAINER_TYPES.has(node.type) &&
      children.some((child) => VECTOR_TYPES.has(child.type)) &&
      children.every((child) => VECTOR_TYPES.has(child.type) || ICON_SHAPE_TYPES.has(child.type));

    if (VECTOR_TYPES.has(node.type) || hasImageFill(node) || isVectorGroup) {
      ids.push(node.id);
      return;
    }

    for (const child of children) walk(child);
  };

  walk(root);
  return ids;
};

/**
 * Makes a filesystem-safe stem from a layer name and node id. The id's
 * separators are mapped, not stripped: `1:234` and `12:34` must not both
 * become `1234`, or the second export silently overwrites the first.
 */
const fileStem = (name: string, nodeId: string): string => {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[\s/_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
  const id = nodeId
    .replace(/:/g, "-")
    .replace(/;/g, "_")
    .replace(/[^a-z0-9_-]/gi, "");
  return base ? `${base}-${id}` : id;
};

/**
 * Exports nodes to files under `outputDir` and returns their relative paths.
 *
 * `outputDir` must resolve inside the MCP server's working directory, matching
 * the containment `import_html_layers` and `save_screenshots` enforce.
 * @param sender - Bridge sender used to request the exports.
 * @param nodeIds - Nodes to export.
 * @param outputDir - Directory relative to the working directory.
 * @param fileKey - Optional target file when several are connected.
 * @returns One record per exported file.
 * @throws When `outputDir` escapes the working directory.
 */
export const exportAssets = async (
  sender: ScreenshotSender,
  nodeIds: string[],
  outputDir: string,
  fileKey?: string
): Promise<AssetRecord[]> => {
  if (nodeIds.length === 0) return [];

  const root = await realpath(process.cwd());
  const escapes = (): never => {
    throw new Error(
      `assetDir "${outputDir}" resolves outside the MCP server working directory (${root}). ` +
        `Choose a directory inside the workspace.`
    );
  };
  const inside = (candidate: string): boolean =>
    candidate === root || candidate.startsWith(root + path.sep);

  // Check the lexical path before touching the filesystem — refusing after
  // mkdir would still leave an empty directory outside the workspace — and the
  // real path afterwards, which is what catches a symlink pointing out.
  const target = path.resolve(root, outputDir);
  if (!inside(target)) escapes();
  await mkdir(target, { recursive: true });
  const resolved = await realpath(target);
  if (!inside(resolved)) escapes();

  const response = await sender.sendWithParams(
    "get_screenshot",
    nodeIds,
    { format: "SVG", clip: true },
    fileKey
  );
  if (response.error) throw new Error(response.error);

  const exports = (
    response.data as { exports?: Array<{ nodeId: string; nodeName: string; base64: string }> }
  )?.exports;
  if (!Array.isArray(exports)) return [];

  const records: AssetRecord[] = [];
  for (const item of exports) {
    const bytes = Buffer.from(item.base64, "base64");
    const file = `${fileStem(item.nodeName, item.nodeId)}.svg`;
    await writeFile(path.join(resolved, file), bytes);
    records.push({
      nodeId: item.nodeId,
      nodeName: item.nodeName,
      file: path.relative(root, path.join(resolved, file)).split(path.sep).join("/"),
      format: "SVG",
      bytes: bytes.length,
    });
  }
  return records;
};
