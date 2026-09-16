import type { SerializedNode } from "./tokens.js";

/**
 * Generates React + Tailwind **reference** code from a serialized tree.
 *
 * Reference, not shippable: the agent adapts it to the target project. The two
 * rules that keep it honest are that a token-bound property never emits its
 * resolved value, and that an instance never pretends to be a codebase
 * component it has not been mapped to.
 */

export interface ReactOptions {
  /** Spaces per indent level. */
  indent?: number;
}

/**
 * Converts a Figma token path into a CSS custom property name.
 * @param tokenName - e.g. `color/brand/primary`.
 * @returns e.g. `--color-brand-primary`.
 */
export const cssVarName = (tokenName: string): string =>
  "--" +
  tokenName
    .trim()
    .toLowerCase()
    .replace(/[\s/_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");

const boundName = (node: SerializedNode, property: string): string | undefined => {
  const binding = node.design?.boundVariables?.find((entry) => entry.property === property);
  return binding?.variableName;
};

/** Prefers the bound token over the resolved value, always. */
const paintValue = (node: SerializedNode): string | undefined => {
  // The serializer emits solid paints as { type: "SOLID", color: "#rrggbb" }.
  const fills = (node.styles as { fills?: Array<{ type?: string; color?: string }> } | undefined)
    ?.fills;
  const first = fills?.[0];
  if (!first || first.type !== "SOLID") return undefined;
  const token = boundName(node, "fills[0]");
  return token ? `var(${cssVarName(token)})` : first.color;
};

const layoutClasses = (node: SerializedNode): string[] => {
  const styles = node.styles as
    | {
        autoLayout?: { direction?: string; gap?: number };
        padding?: { top: number; right: number; bottom: number; left: number };
        cornerRadius?: number | string;
      }
    | undefined;
  const classes: string[] = [];

  if (styles?.autoLayout) {
    classes.push("flex", styles.autoLayout.direction === "VERTICAL" ? "flex-col" : "flex-row");
    if (styles.autoLayout.gap) classes.push(`gap-[${styles.autoLayout.gap}px]`);
  }

  const padding = styles?.padding;
  if (padding) {
    const uniform =
      padding.top === padding.right &&
      padding.right === padding.bottom &&
      padding.bottom === padding.left;
    classes.push(
      uniform
        ? `p-[${padding.top}px]`
        : `pt-[${padding.top}px] pr-[${padding.right}px] pb-[${padding.bottom}px] pl-[${padding.left}px]`
    );
  }

  if (typeof styles?.cornerRadius === "number" && styles.cornerRadius > 0) {
    classes.push(`rounded-[${styles.cornerRadius}px]`);
  }

  const sizing = node.layout as { sizingHorizontal?: string; sizingVertical?: string } | undefined;
  if (sizing?.sizingHorizontal === "FILL") classes.push("w-full");
  if (sizing?.sizingVertical === "FILL") classes.push("h-full");

  return classes;
};

const attributes = (node: SerializedNode): string => {
  const classes = layoutClasses(node);
  const background = paintValue(node);
  const parts: string[] = [];
  if (classes.length > 0) parts.push(`className="${classes.join(" ")}"`);
  if (background && node.type !== "TEXT") parts.push(`style={{ background: "${background}" }}`);
  if (background && node.type === "TEXT") parts.push(`style={{ color: "${background}" }}`);
  return parts.length > 0 ? " " + parts.join(" ") : "";
};

/**
 * Escapes text for a JSX or HTML text position. Entities are used for the
 * braces too, rather than JSX's `{"{"}`, because the HTML generator derives
 * its output from this one and entities are valid in both grammars.
 */
export const escapeText = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;");

const render = (node: SerializedNode, depth: number, indent: number): string[] => {
  const pad = " ".repeat(depth * indent);
  const lines: string[] = [];

  if (node.type === "INSTANCE" && node.design?.mainComponent?.name) {
    lines.push(
      `${pad}{/* Figma component: ${node.design.mainComponent.name} — map with Code Connect */}`
    );
    lines.push(`${pad}<div${attributes(node)} data-figma-node="${node.id}" />`);
    return lines;
  }

  if (node.type === "TEXT") {
    const style = node.design?.styles?.text;
    const styleName = style && style !== "mixed" ? style.name : undefined;
    if (styleName) lines.push(`${pad}{/* text style: ${styleName} */}`);
    const characters = typeof node.characters === "string" ? escapeText(node.characters) : "";
    lines.push(`${pad}<span${attributes(node)}>${characters}</span>`);
    return lines;
  }

  const children = node.children ?? [];
  if (children.length === 0) {
    lines.push(`${pad}<div${attributes(node)} />`);
    return lines;
  }

  lines.push(`${pad}<div${attributes(node)}>`);
  for (const child of children) lines.push(...render(child, depth + 1, indent));
  lines.push(`${pad}</div>`);
  return lines;
};

/**
 * Renders a serialized tree as React reference code.
 * @param node - The serialized root.
 * @param options - Indent width.
 * @returns A JSX string, deterministic for a given tree.
 */
export const toReact = (node: SerializedNode, options: ReactOptions = {}): string =>
  render(node, 0, options.indent ?? 2).join("\n");
