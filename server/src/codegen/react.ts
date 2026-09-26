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
  /**
   * Node id → workspace-relative file for nodes that were exported as assets.
   * Such a node renders as an image reference; its paths are not emitted.
   */
  assets?: Record<string, string>;
  /**
   * Node id → Code Connect mapping for instances the workspace already
   * implements. Such an instance renders as the mapped component.
   */
  mappings?: Record<string, CodeConnectRef>;
}

/** The part of a Code Connect mapping the generator needs. */
export interface CodeConnectRef {
  component: string;
  /** The mapping file, so the agent can read how Figma properties map to props. */
  source: string;
}

/**
 * Formats a length for CSS. Figma stores geometry as floats and
 * 13.333333969116211 is noise, not intent; two decimals is what a designer
 * would have typed.
 * @param value - A length in Figma units.
 * @returns e.g. `13.33px`, `28px`.
 */
export const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

/** The name an agent needs for a main component: the set's, with the variant as detail. */
export const componentLabel = (ref: { name?: string; setName?: string }): string =>
  ref.setName && ref.name ? `${ref.setName} (${ref.name})` : (ref.setName ?? ref.name ?? "");

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
    if (styles.autoLayout.gap) classes.push(`gap-[${px(styles.autoLayout.gap)}]`);
  }

  const padding = styles?.padding;
  if (padding) {
    const uniform =
      padding.top === padding.right &&
      padding.right === padding.bottom &&
      padding.bottom === padding.left;
    classes.push(
      uniform
        ? `p-[${px(padding.top)}]`
        : `pt-[${px(padding.top)}] pr-[${px(padding.right)}] pb-[${px(padding.bottom)}] pl-[${px(padding.left)}]`
    );
  }

  if (typeof styles?.cornerRadius === "number" && styles.cornerRadius > 0) {
    classes.push(`rounded-[${px(styles.cornerRadius)}]`);
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

/**
 * Makes designer copy safe inside a one-line comment: newlines collapse, and
 * neither JSX's `*\/` nor HTML's `-->` (the HTML generator rewrites these
 * comments) can end the comment early.
 */
const commentText = (text: string): string =>
  text.replace(/\s+/g, " ").trim().replace(/\*\//g, "* /").replace(/-->/g, "-- >");

/**
 * The hints R25 ranks below Code Connect and above tokens, in that order: the
 * main component's description (for a node rendered as a component), then each
 * Dev Mode annotation. Each line names its source.
 */
const hintLines = (node: SerializedNode, pad: string, withDescription: boolean): string[] => {
  const lines: string[] = [];
  const description = withDescription ? node.design?.mainComponent?.description : undefined;
  if (description && description.trim() !== "") {
    lines.push(`${pad}{/* component description: ${commentText(description)} */}`);
  }
  for (const annotation of node.annotations ?? []) {
    const parts: string[] = [];
    if (annotation.label && annotation.label.trim() !== "") {
      parts.push(commentText(annotation.label));
    }
    if (annotation.properties && annotation.properties.length > 0) {
      parts.push(`[${annotation.properties.map(commentText).join(", ")}]`);
    }
    if (parts.length > 0) lines.push(`${pad}{/* annotation: ${parts.join(" ")} */}`);
  }
  return lines;
};

const render = (
  node: SerializedNode,
  depth: number,
  indent: number,
  assets: Record<string, string>,
  mappings: Record<string, CodeConnectRef>
): string[] => {
  const pad = " ".repeat(depth * indent);
  const lines: string[] = [];

  // An exported node is a file on disk. Emitting its paths as coloured divs
  // would be exactly the hand-drawn markup the asset contract forbids.
  const file = assets[node.id];
  if (file) {
    lines.push(...hintLines(node, pad, false));
    lines.push(
      `${pad}<img src="${file}" alt="${escapeText(node.name)}" data-figma-node="${node.id}" />`
    );
    return lines;
  }

  // An instance is a placeholder for a codebase component the generator must
  // not invent — but its content (the button label, the nested icon) is still
  // what the agent has to render, so the children are emitted inside it.
  // A mapping outranks every other hint: the workspace already has this
  // component, so the code names it rather than a placeholder.
  const mapped = node.type === "INSTANCE" ? mappings[node.id] : undefined;
  if (mapped) {
    lines.push(`${pad}{/* Code Connect: ${mapped.component} — ${mapped.source} */}`);
    lines.push(...hintLines(node, pad, true));
    const inner = node.children ?? [];
    if (inner.length === 0) {
      lines.push(`${pad}<${mapped.component} data-figma-node="${node.id}" />`);
      return lines;
    }
    lines.push(`${pad}<${mapped.component} data-figma-node="${node.id}">`);
    for (const child of inner) lines.push(...render(child, depth + 1, indent, assets, mappings));
    lines.push(`${pad}</${mapped.component}>`);
    return lines;
  }

  if (node.type === "INSTANCE" && node.design?.mainComponent?.name) {
    lines.push(
      `${pad}{/* Figma component: ${componentLabel(node.design.mainComponent)} — map with Code Connect */}`
    );
    lines.push(...hintLines(node, pad, true));
    const inner = node.children ?? [];
    if (inner.length === 0) {
      lines.push(`${pad}<div${attributes(node)} data-figma-node="${node.id}" />`);
      return lines;
    }
    lines.push(`${pad}<div${attributes(node)} data-figma-node="${node.id}">`);
    for (const child of inner) lines.push(...render(child, depth + 1, indent, assets, mappings));
    lines.push(`${pad}</div>`);
    return lines;
  }

  // Every remaining node is a plain element: its annotations are its only hint
  // above the token rank (a text style sits with the tokens, below them).
  lines.push(...hintLines(node, pad, false));

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
  for (const child of children) lines.push(...render(child, depth + 1, indent, assets, mappings));
  lines.push(`${pad}</div>`);
  return lines;
};

/**
 * Renders a serialized tree as React reference code.
 * @param node - The serialized root.
 * @param options - Indent width, the exported-asset map and the Code Connect mappings.
 * @returns A JSX string, deterministic for a given tree.
 */
export const toReact = (node: SerializedNode, options: ReactOptions = {}): string =>
  render(node, 0, options.indent ?? 2, options.assets ?? {}, options.mappings ?? {}).join("\n");
