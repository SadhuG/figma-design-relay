import { toCss } from "./css.js";
import { toHtml } from "./html.js";
import { toReact } from "./react.js";
import type { SerializedNode } from "./tokens.js";

export type CodeFormat = "react" | "html" | "css" | "json";

export const CODE_FORMATS: CodeFormat[] = ["react", "html", "css", "json"];

/**
 * Renders a serialized tree in the requested reference format.
 * @param node - The serialized root.
 * @param format - One of `CODE_FORMATS`.
 * @returns The rendered string.
 * @throws When the format is not supported, naming both the request and the alternatives.
 */
export const generateCode = (node: SerializedNode, format: CodeFormat): string => {
  switch (format) {
    case "react":
      return toReact(node);
    case "html":
      return toHtml(node);
    case "css":
      return toCss(node);
    case "json":
      return JSON.stringify(node, null, 2);
    default:
      throw new Error(
        `Unsupported format "${format}". Supported formats: ${CODE_FORMATS.join(", ")}.`
      );
  }
};

export { toCss, toHtml, toReact };
