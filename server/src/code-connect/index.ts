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

export interface MappingSelection {
  mappings: Mapping[];
  unmapped: string[];
  /**
   * Ids mapped in more than one Figma file, when no real file key says which.
   * Present only when non-empty. Distinct from `unmapped`: a mapping does exist,
   * so the caller must not write a new component for it.
   */
  ambiguous?: Record<string, Mapping[]>;
}

/**
 * Looks up a list of node ids, as `get_code_connect_map` does when given some.
 * @param index - The workspace's Code Connect index.
 * @param nodeIds - Colon-form node ids.
 * @param fileKey - A real Figma file key, when known (see `pickFigmaFileKey`).
 */
export const selectMappings = (
  index: Pick<CodeConnectIndex, "mappings" | "lookup">,
  nodeIds: string[],
  fileKey?: string
): MappingSelection => {
  const mappings: Mapping[] = [];
  const unmapped: string[] = [];
  const ambiguous: Record<string, Mapping[]> = {};
  for (const id of nodeIds) {
    const mapping = index.lookup(id, fileKey);
    if (mapping) {
      mappings.push(mapping);
      continue;
    }
    const candidates = fileKey ? [] : index.mappings.filter((m) => m.nodeId === id);
    if (candidates.length > 1) ambiguous[id] = candidates;
    else unmapped.push(id);
  }
  return Object.keys(ambiguous).length > 0
    ? { mappings, unmapped, ambiguous }
    : { mappings, unmapped };
};

/**
 * The mappings for one Figma file, as `get_code_connect_map` lists them.
 * @param index - The workspace's Code Connect index.
 * @param fileKey - The key the caller passed. A session key names a relay
 * connection rather than a Figma file, so it filters nothing out — filtering on
 * it would return no mappings at all.
 */
export const mappingsForFile = (
  index: Pick<CodeConnectIndex, "mappings">,
  fileKey?: string
): Mapping[] => {
  const figmaKey = pickFigmaFileKey(fileKey, []);
  return figmaKey
    ? index.mappings.filter((mapping) => mapping.fileKey === figmaKey)
    : index.mappings;
};

/**
 * The Figma file key a Code Connect lookup should match against.
 *
 * The plugin reports `figma.fileKey` when Figma exposes it — only to private
 * plugins — and otherwise a session key starting `unsaved-`. A session key
 * names a relay connection, not a Figma file, so it is treated as unknown.
 * @param explicit - The key the caller passed, if any.
 * @param connected - The keys of the connected files.
 * @returns The key, or undefined when none is known — lookups then fall back
 * to node ids that are unique across every mapping.
 */
export const pickFigmaFileKey = (
  explicit: string | undefined,
  connected: string[]
): string | undefined => {
  const real = (key: string | undefined): string | undefined =>
    key && !key.startsWith("unsaved-") ? key : undefined;
  if (explicit) return real(explicit);
  return connected.length === 1 ? real(connected[0]) : undefined;
};
