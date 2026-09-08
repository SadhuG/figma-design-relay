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

/**
 * Property names worth reproducing for an object.
 *
 * Most values a script returns are plain objects, where own enumerable keys are
 * the whole story. Plugin API objects that are *not* nodes — `Variable`,
 * `VariableCollection`, `TextStyle`, `Effect` handles — instead expose
 * everything through prototype getters and have no own keys at all, so a plain
 * `Object.keys` walk would serialise them as `{}` with no error to explain it.
 * Fall back to the prototype chain's getters in that case. Methods are skipped:
 * they carry no state and would only add `"[function]"` noise.
 */
const readableKeys = (value: object): string[] => {
  const own = Object.keys(value);
  if (own.length > 0) return own;

  const keys = new Set<string>();
  for (
    let proto: object | null = Object.getPrototypeOf(value) as object | null;
    proto !== null && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (key !== "constructor" && typeof descriptor.get === "function") keys.add(key);
    }
  }
  return [...keys];
};

/**
 * Reads one property, tolerating a getter that throws. Plugin API getters do
 * throw — reading almost anything off a removed node raises — and one such
 * property must not cost the agent the rest of an otherwise good result.
 */
const readProperty = (value: object, key: string): unknown => {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return "[unreadable]";
  }
};

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
    for (const key of readableKeys(value)) {
      out[key] = toJsonSafeInner(readProperty(value, key), depth + 1, seen);
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
