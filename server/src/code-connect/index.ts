import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverCodeConnectFiles } from "./discover.js";
import type { SerializedNode } from "../codegen/tokens.js";
import { parseCodeConnect, type Mapping } from "./parse.js";

export interface CodeConnectIndex {
  mappings: Mapping[];
  errors: string[];
  filesScanned: number;
  /**
   * Finds the mapping for a node.
   * @param nodeId - Colon-form node id.
   * @param fileKey - The file the node lives in. When known, only that file's
   * mappings match: node ids like `1:2` recur in every Figma file, so a match on
   * the id alone would claim a component for the wrong design.
   */
  lookup: (nodeId: string, fileKey?: string) => Mapping | undefined;
}

/**
 * Builds the Code Connect index for a workspace.
 *
 * Rebuilt on every call rather than cached: an agent may have written a mapping
 * seconds ago, and a stale index is worse than a directory walk.
 * @param root - The MCP server's working directory.
 */
export const buildCodeConnectIndex = async (root: string): Promise<CodeConnectIndex> => {
  const files = await discoverCodeConnectFiles(root);
  const mappings: Mapping[] = [];
  const errors: string[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = await readFile(path.join(root, file), "utf8");
    } catch (err) {
      errors.push(
        `${file} — could not be read: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const result = parseCodeConnect(source, file);
    mappings.push(...result.mappings);
    errors.push(...result.errors);
  }

  const lookup = (nodeId: string, fileKey?: string): Mapping | undefined => {
    const candidates = mappings.filter((mapping) => mapping.nodeId === nodeId);
    if (fileKey) return candidates.find((mapping) => mapping.fileKey === fileKey);
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  return { mappings, errors, filesScanned: files.length, lookup };
};

/**
 * Finds the mapping behind every node in a serialized design tree.
 *
 * A mapping targets a COMPONENT or COMPONENT_SET, but a design is made of
 * instances with ids of their own — so an instance is matched through its
 * main component's set first (where Code Connect mappings usually point), then
 * through the main component itself.
 * @param tree - The serialized root.
 * @param index - The workspace's Code Connect index.
 * @param fileKey - The file the tree came from, when known.
 * @returns Design node id → mapping, for mapped nodes only.
 */
export const mappingsForTree = (
  tree: SerializedNode,
  index: Pick<CodeConnectIndex, "lookup">,
  fileKey?: string
): Record<string, Mapping> => {
  const found: Record<string, Mapping> = {};
  const visit = (node: SerializedNode): void => {
    const main = node.design?.mainComponent;
    const mapping =
      node.type === "INSTANCE" && main
        ? ((main.setId ? index.lookup(main.setId, fileKey) : undefined) ??
          index.lookup(main.id, fileKey))
        : node.type === "COMPONENT" || node.type === "COMPONENT_SET"
          ? index.lookup(node.id, fileKey)
          : undefined;
    if (mapping) found[node.id] = mapping;
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return found;
};
