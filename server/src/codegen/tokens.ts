/**
 * Collects the design tokens a serialized subtree actually uses.
 *
 * Pure: a tree in, a list out. The shapes mirror what phase 2's serializer
 * emits, kept structural rather than imported so the server never depends on
 * the plugin's build.
 */

export interface SerializedNode {
  id: string;
  name: string;
  type: string;
  design?: {
    boundVariables?: Array<{
      property: string;
      variableId: string;
      variableName?: string;
      collectionName?: string;
    }>;
    styles?: Record<string, { id: string; name?: string } | "mixed">;
    mainComponent?: { id: string; key?: string; name?: string };
  };
  children?: SerializedNode[];
  [key: string]: unknown;
}

export interface TokenUse {
  /** The token's name, or its id when the name never resolved. */
  name: string;
  kind: "variable" | "style";
  /** The node property the token is bound to, e.g. `fills[0]` or `text`. */
  property: string;
  collection?: string;
  /** Ids of every node using it, in document order. */
  usedBy: string[];
  /** False when only the id was available. */
  resolved?: boolean;
}

/**
 * Walks a serialized subtree and returns its tokens, deduplicated by name and
 * ordered by first use.
 * @param root - The serialized node to walk.
 * @returns One entry per distinct token.
 */
export const collectTokens = (root: SerializedNode): TokenUse[] => {
  const byName = new Map<string, TokenUse>();

  const record = (token: Omit<TokenUse, "usedBy">, nodeId: string): void => {
    const existing = byName.get(token.name);
    if (existing) {
      if (!existing.usedBy.includes(nodeId)) existing.usedBy.push(nodeId);
      return;
    }
    byName.set(token.name, { ...token, usedBy: [nodeId] });
  };

  const walk = (node: SerializedNode): void => {
    for (const binding of node.design?.boundVariables ?? []) {
      const resolved = typeof binding.variableName === "string";
      const entry: Omit<TokenUse, "usedBy"> = {
        name: resolved ? (binding.variableName as string) : binding.variableId,
        kind: "variable",
        property: binding.property,
      };
      if (binding.collectionName) entry.collection = binding.collectionName;
      if (!resolved) entry.resolved = false;
      record(entry, node.id);
    }

    for (const [property, style] of Object.entries(node.design?.styles ?? {})) {
      if (style === "mixed") continue;
      const resolved = typeof style.name === "string";
      const entry: Omit<TokenUse, "usedBy"> = {
        name: resolved ? (style.name as string) : style.id,
        kind: "style",
        property,
      };
      if (!resolved) entry.resolved = false;
      record(entry, node.id);
    }

    for (const child of node.children ?? []) walk(child);
  };

  walk(root);
  return [...byName.values()];
};
