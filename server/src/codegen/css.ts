import { cssVarName, px } from "./react.js";
import type { SerializedNode } from "./tokens.js";

/** Turns a Figma layer name into a stable class selector. */
const className = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s/_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-") || "node";

const declarations = (node: SerializedNode): string[] => {
  const styles = node.styles as
    | {
        fills?: Array<{ type?: string; color?: string }>;
        autoLayout?: { direction?: string; gap?: number };
        padding?: { top: number; right: number; bottom: number; left: number };
        cornerRadius?: number | string;
      }
    | undefined;
  const out: string[] = [];

  const fill = styles?.fills?.[0];
  if (fill?.type === "SOLID") {
    const token = node.design?.boundVariables?.find((b) => b.property === "fills[0]")?.variableName;
    const value = token ? `var(${cssVarName(token)})` : fill.color;
    if (value) out.push(`${node.type === "TEXT" ? "color" : "background"}: ${value};`);
  }

  if (styles?.autoLayout) {
    out.push("display: flex;");
    out.push(`flex-direction: ${styles.autoLayout.direction === "VERTICAL" ? "column" : "row"};`);
    if (styles.autoLayout.gap) out.push(`gap: ${px(styles.autoLayout.gap)};`);
  }

  const padding = styles?.padding;
  if (padding) {
    out.push(
      `padding: ${px(padding.top)} ${px(padding.right)} ${px(padding.bottom)} ${px(padding.left)};`
    );
  }

  if (typeof styles?.cornerRadius === "number" && styles.cornerRadius > 0) {
    out.push(`border-radius: ${px(styles.cornerRadius)};`);
  }

  return out;
};

/**
 * Renders one CSS rule per node that has anything to say.
 * @param root - The serialized root.
 * @returns A stylesheet string.
 */
export const toCss = (root: SerializedNode): string => {
  const rules: string[] = [];
  const seen = new Set<string>();

  const walk = (node: SerializedNode): void => {
    const body = declarations(node);
    if (body.length > 0) {
      let selector = className(node.name);
      while (seen.has(selector)) selector = `${selector}-${node.id.replace(/[^a-z0-9]/gi, "")}`;
      seen.add(selector);
      rules.push(`.${selector} {\n  ${body.join("\n  ")}\n}`);
    }
    for (const child of node.children ?? []) walk(child);
  };

  walk(root);
  return rules.join("\n\n");
};
