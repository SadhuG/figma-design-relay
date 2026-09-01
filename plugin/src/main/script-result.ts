/**
 * Converts the value a `run_script` script returned into something
 * `JSON.stringify` can handle and an agent can read.
 *
 * Kept free of any `figma` reference so it can be unit-tested outside the
 * plugin sandbox — Figma nodes are recognised structurally instead.
 */

/** Deepest object nesting reproduced before bailing out. */
export const MAX_RESULT_DEPTH = 12;

/** Most array entries reproduced per array before bailing out. */
export const MAX_ARRAY_ITEMS = 500;

/**
 * Structural test for a Figma node. Every `SceneNode`, `PageNode` and
 * `DocumentNode` carries a string `id`, a string `type`, and the plugin-data
 * methods; no plain object returned by a script realistically has all three.
 */
const isFigmaNode = (value: object): boolean =>
  typeof (value as { id?: unknown }).id === "string" &&
  typeof (value as { type?: unknown }).type === "string" &&
  typeof (value as { setPluginData?: unknown }).setPluginData === "function";

const toJsonSafeInner = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
  // `figma.mixed` is a symbol, and so is every other "mixed" sentinel.
  if (typeof value === "symbol") return "mixed";
  if (typeof value === "function") return "[function]";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (value === null || typeof value !== "object") return value;

  if (isFigmaNode(value)) {
    const node = value as { id: string; name?: unknown; type: string };
    return {
      id: node.id,
      name: typeof node.name === "string" ? node.name : undefined,
      type: node.type,
    };
  }

  // Only ancestors count as circular; two siblings pointing at one object are
  // fine and should both be expanded.
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_RESULT_DEPTH) return "[max depth]";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => toJsonSafeInner(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) {
        items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
      }
      return items;
    }

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = toJsonSafeInner((value as Record<string, unknown>)[key], depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
};

/**
 * Sanitises an arbitrary script return value for the wire.
 * @param value - Whatever the script returned.
 * @returns A structurally equivalent, JSON-serialisable value.
 */
export const toJsonSafe = (value: unknown): unknown =>
  toJsonSafeInner(value, 0, new WeakSet<object>());
