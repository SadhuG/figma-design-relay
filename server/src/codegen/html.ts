import { toReact } from "./react.js";
import type { SerializedNode } from "./tokens.js";

/**
 * Renders the React output as plain HTML.
 *
 * The two grammars differ in exactly three places for the subset we emit, so
 * deriving one from the other keeps a single structural code path — and means
 * a structural bug shows up in both tests, not one.
 * @param node - The serialized root.
 * @returns An HTML string.
 */
export const toHtml = (node: SerializedNode): string =>
  toReact(node)
    .replace(/className=/g, "class=")
    .replace(
      /style=\{\{\s*([a-zA-Z]+):\s*"([^"]*)"\s*\}\}/g,
      (_, property: string, value: string) => {
        const kebab = property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        return `style="${kebab}: ${value}"`;
      }
    )
    .replace(/\{\/\*\s*(.*?)\s*\*\/\}/g, "<!-- $1 -->");
