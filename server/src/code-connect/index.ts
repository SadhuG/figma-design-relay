import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverCodeConnectFiles } from "./discover.js";
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
