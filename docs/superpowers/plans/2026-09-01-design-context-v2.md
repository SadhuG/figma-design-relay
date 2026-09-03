# Design Context v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `get_design_context` answer the whole design-to-code question in one call — reference code, an inline screenshot, the token names the design actually uses, and exported assets on disk — instead of returning a raw JSON tree the agent has to interpret alone.

**Architecture:** All code generation happens server-side in pure modules under `server/src/codegen/`, so it is golden-file testable and never bloats the plugin bundle. The plugin's job stays what it already is: serialize the tree and export bytes. The tool handler composes the pieces into a multi-part MCP result — one text block with code and tokens, one image block with the screenshot.

**Tech Stack:** TypeScript, Bun (`bun test`), Zod, `@modelcontextprotocol/sdk`, `ws`, the Figma Plugin API.

**Spec:** `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md` — this plan implements that spec's **Phase 3** and its requirements R20–R27.

## Global Constraints

- Node `>=20.0.0`; Bun is the package manager and script runner throughout.
- The server is ESM with `"module": "Node16"`: **relative imports inside `server/src` must carry a `.js` extension** (e.g. `./codegen/react.js`).
- Prettier 3.9.6 formats everything; a Husky `pre-commit` hook runs `lint-staged`.
- **Phase 2 must have landed.** This plan reads `design.boundVariables` and `design.styles` off serialized nodes, which phase 2 (R14, R15) adds. Without it, every generated value falls back to a raw hex and R23 cannot be satisfied.
- **Codegen never runs in the plugin sandbox.** Everything under `server/src/codegen/` is pure: serialized tree in, string out, no I/O and no `figma`.
- Filesystem writes stay inside the MCP server's working directory, resolved with `realpath`, matching the containment `import_html_layers` and `save_screenshots` already enforce.
- Result size is bounded the same way `run_script` bounds its own: a `depth` parameter plus a documented character cap with a flagged truncation.
- Every new tool parameter registers in `toolInputSchemas` **and** `rpcToArgs` in the same commit — `rpcToArgs` is typed `Record<ToolName, …>`, so omitting it is a compile error.
- Never reformat or restructure code outside the files each task lists.

---

### Task 1: Multi-part tool results [R21]

`ToolResult` in `server/src/tools.ts` allows only text blocks today, so `get_screenshot` returns a base64 blob inside a text block and the agent never actually sees the image. Widening the type is a two-line change; the interesting part is deciding which formats become image blocks and which stay text.

**Files:**

- Create: `server/src/content.ts`
- Create: `server/src/content.test.ts`
- Modify: `server/src/tools.ts` — replace the local `ToolResult` type (currently lines 41-44) with an import

**Interfaces:**

- Consumes: `ExportFormat` from `./tools.js`.
- Produces: `ContentBlock`, `ToolResult`, `textBlock(text)`, `imageBlock(base64, format)` and `IMAGE_MIME_TYPES`. Tasks 5 and 6 import them from `./content.js`.

- [ ] **Step 1: Write the failing test**

_server/src/content.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { imageBlock, textBlock } from "./content.js";

describe("textBlock", () => {
  test("wraps a string", () => {
    expect(textBlock("hi")).toEqual({ type: "text", text: "hi" });
  });
});

describe("imageBlock", () => {
  test("maps PNG to image/png", () => {
    expect(imageBlock("AAAA", "PNG")).toEqual({
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    });
  });

  test("maps JPG to image/jpeg", () => {
    expect(imageBlock("AAAA", "JPG")?.mimeType).toBe("image/jpeg");
  });

  test("returns null for formats MCP clients cannot render inline", () => {
    expect(imageBlock("AAAA", "SVG")).toBeNull();
    expect(imageBlock("AAAA", "PDF")).toBeNull();
  });

  test("returns null for empty data rather than an empty image", () => {
    expect(imageBlock("", "PNG")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/content.test.ts`
Expected: FAIL — `Cannot find module './content.js'`

- [ ] **Step 3: Write the implementation**

_server/src/content.ts — create_

```ts
import type { ExportFormat } from "./tools.js";

/**
 * MCP tool results are a list of typed content blocks. The server only emitted
 * text blocks before phase 3, which meant screenshots reached agents as base64
 * strings they could not see.
 */
export type ContentBlock =
  { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
}

/**
 * Formats that MCP clients render inline. SVG and PDF are deliberately absent:
 * client support is inconsistent, so they stay text and are better served by
 * `save_screenshots` writing a real file.
 */
export const IMAGE_MIME_TYPES: Partial<Record<ExportFormat, string>> = {
  PNG: "image/png",
  JPG: "image/jpeg",
};

/**
 * Builds a text content block.
 * @param text - The text to send.
 */
export const textBlock = (text: string): ContentBlock => ({ type: "text", text });

/**
 * Builds an image content block when the format can be rendered inline.
 * @param base64 - Base64-encoded image bytes.
 * @param format - The export format the bytes came from.
 * @returns The block, or null when the format is not inline-renderable.
 */
export const imageBlock = (base64: string, format: ExportFormat): ContentBlock | null => {
  const mimeType = IMAGE_MIME_TYPES[format];
  if (!mimeType || base64 === "") return null;
  return { type: "image", data: base64, mimeType };
};
```

- [ ] **Step 4: Adopt the shared type in tools.ts**

Delete the local `ToolResult` declaration near the top of `server/src/tools.ts` and import it instead. Every existing handler keeps compiling, because a text-only array still satisfies the wider type.

```ts
import { imageBlock, textBlock, type ToolResult } from "./content.js";
```

- [ ] **Step 5: Run the tests and verify the server builds**

Run: `cd server && bun run test && bun run build`
Expected: PASS — 5 new tests pass and `tsc` reports no errors

- [ ] **Step 6: Commit**

```bash
git add server/src/content.ts server/src/content.test.ts server/src/tools.ts
git commit -m "feat(server): support image content blocks in tool results"
```

---

### Task 2: Token extraction [R23]

Phase 2 put the token name on each node. This walks the tree and collects them into one list, so the response can open with "here are the fourteen tokens this screen uses" instead of making the agent infer them from scattered hexes.

**Files:**

- Create: `server/src/codegen/tokens.ts`
- Create: `server/src/codegen/tokens.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `collectTokens(node): TokenUse[]` and the `SerializedNode`, `TokenUse` types. Tasks 3, 4 and 6 import them from `./codegen/tokens.js`.

- [ ] **Step 1: Write the failing test**

_server/src/codegen/tokens.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { collectTokens } from "./tokens.js";

const tree = {
  id: "1:1",
  name: "Card",
  type: "FRAME",
  design: {
    boundVariables: [
      {
        property: "fills[0]",
        variableId: "V:1",
        variableName: "color/surface",
        collectionName: "Brand",
      },
    ],
  },
  children: [
    {
      id: "1:2",
      name: "Title",
      type: "TEXT",
      design: {
        boundVariables: [
          {
            property: "fills[0]",
            variableId: "V:2",
            variableName: "color/text",
            collectionName: "Brand",
          },
        ],
        styles: { text: { id: "S:1", name: "Heading/M" } },
      },
    },
    {
      id: "1:3",
      name: "Body",
      type: "TEXT",
      design: {
        boundVariables: [
          {
            property: "fills[0]",
            variableId: "V:2",
            variableName: "color/text",
            collectionName: "Brand",
          },
        ],
      },
    },
  ],
};

describe("collectTokens", () => {
  test("collects variables and styles from the whole subtree", () => {
    const names = collectTokens(tree).map((token) => token.name);
    expect(names).toEqual(["color/surface", "color/text", "Heading/M"]);
  });

  test("deduplicates a token used twice and records both users", () => {
    const text = collectTokens(tree).find((token) => token.name === "color/text");
    expect(text?.usedBy).toEqual(["1:2", "1:3"]);
  });

  test("distinguishes variables from styles", () => {
    const kinds = collectTokens(tree).map((token) => token.kind);
    expect(kinds).toEqual(["variable", "variable", "style"]);
  });

  test("returns an empty list for a tree with no design system", () => {
    expect(collectTokens({ id: "2:1", name: "Plain", type: "RECTANGLE" })).toEqual([]);
  });

  test("keeps a token whose name never resolved, under its id", () => {
    const out = collectTokens({
      id: "3:1",
      name: "Odd",
      type: "FRAME",
      design: { boundVariables: [{ property: "opacity", variableId: "V:9" }] },
    });
    expect(out).toEqual([
      { name: "V:9", kind: "variable", property: "opacity", usedBy: ["3:1"], resolved: false },
    ]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/codegen/tokens.test.ts`
Expected: FAIL — `Cannot find module './tokens.js'`

- [ ] **Step 3: Write the implementation**

_server/src/codegen/tokens.ts — create_

```ts
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/codegen/tokens.test.ts`
Expected: PASS — 5 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add server/src/codegen/tokens.ts server/src/codegen/tokens.test.ts
git commit -m "feat(server): collect design tokens from a serialized tree"
```

---

### Task 3: React reference codegen [R22, R23, R27]

The output is a **reference**, not shippable code — the agent adapts it to the project's real stack. What matters is that it is faithful about structure, and that it never hardcodes a value the design bound to a token.

Two rules make the difference between useful and misleading output: a bound property emits `var(--token-name)`, and an instance emits a comment naming its Figma component rather than pretending to be a codebase component it has not been mapped to.

**Files:**

- Create: `server/src/codegen/react.ts`
- Create: `server/src/codegen/react.test.ts`
- Create: `server/src/codegen/fixtures/card.json`

**Interfaces:**

- Consumes: `SerializedNode`, `TokenUse` from `./tokens.js`.
- Produces: `toReact(node, options): string` and `cssVarName(tokenName): string`. Task 4 reuses `cssVarName`; task 6 calls `toReact`.

- [ ] **Step 1: Write the fixture**

_server/src/codegen/fixtures/card.json — create_

```json
{
  "id": "1:1",
  "name": "Card",
  "type": "FRAME",
  "bounds": { "x": 0, "y": 0, "width": 320, "height": 140 },
  "styles": {
    "autoLayout": { "direction": "VERTICAL", "gap": 12 },
    "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 },
    "cornerRadius": 8,
    "fills": [{ "type": "SOLID", "hex": "#101820" }]
  },
  "design": {
    "boundVariables": [
      { "property": "fills[0]", "variableId": "V:1", "variableName": "color/surface" }
    ]
  },
  "children": [
    {
      "id": "1:2",
      "name": "Title",
      "type": "TEXT",
      "characters": "Monthly report",
      "styles": { "fills": [{ "type": "SOLID", "hex": "#FFFFFF" }] },
      "design": { "styles": { "text": { "id": "S:1", "name": "Heading/M" } } }
    },
    {
      "id": "1:3",
      "name": "Confirm",
      "type": "INSTANCE",
      "styles": {},
      "design": { "mainComponent": { "id": "9:1", "key": "btn", "name": "Button/Primary" } }
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

_server/src/codegen/react.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import card from "./fixtures/card.json" with { type: "json" };
import { cssVarName, toReact } from "./react.js";
import type { SerializedNode } from "./tokens.js";

const output = toReact(card as unknown as SerializedNode);

describe("cssVarName", () => {
  test("turns a token path into a CSS custom property", () => {
    expect(cssVarName("color/brand/primary")).toBe("--color-brand-primary");
  });

  test("collapses spaces and casing", () => {
    expect(cssVarName("Heading/M Bold")).toBe("--heading-m-bold");
  });
});

describe("toReact", () => {
  test("emits auto-layout as flex with the real gap and padding", () => {
    expect(output).toContain("flex flex-col");
    expect(output).toContain("gap-[12px]");
    expect(output).toContain("p-[16px]");
  });

  test("uses the token, never the hex, for a bound fill", () => {
    expect(output).toContain("var(--color-surface)");
    expect(output).not.toContain("#101820");
  });

  test("falls back to the raw hex where nothing is bound", () => {
    expect(output).toContain("#FFFFFF");
  });

  test("names the Figma component instead of inventing one", () => {
    expect(output).toContain("{/* Figma component: Button/Primary — map with Code Connect */}");
  });

  test("renders text content", () => {
    expect(output).toContain("Monthly report");
  });

  test("is stable across runs", () => {
    expect(toReact(card as unknown as SerializedNode)).toBe(output);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd server && bun test src/codegen/react.test.ts`
Expected: FAIL — `Cannot find module './react.js'`

- [ ] **Step 4: Write the implementation**

_server/src/codegen/react.ts — create_

```ts
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
  const fills = (node.styles as { fills?: Array<{ type?: string; hex?: string }> } | undefined)
    ?.fills;
  const first = fills?.[0];
  if (!first || first.type !== "SOLID") return undefined;
  const token = boundName(node, "fills[0]");
  return token ? `var(${cssVarName(token)})` : first.hex;
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
    const characters = typeof node.characters === "string" ? node.characters : "";
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
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `cd server && bun test src/codegen/react.test.ts`
Expected: PASS — 8 pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add server/src/codegen/react.ts server/src/codegen/react.test.ts server/src/codegen/fixtures/card.json
git commit -m "feat(server): generate React reference code from a serialized tree"
```

---

### Task 4: CSS and HTML codegen, and the format dispatcher [R22, R27]

Three formats share one fixture, so a change that breaks structure breaks all three tests at once. The dispatcher is what `get_design_context` will call in task 6.

**Files:**

- Create: `server/src/codegen/index.ts`
- Create: `server/src/codegen/html.ts`
- Create: `server/src/codegen/css.ts`
- Create: `server/src/codegen/index.test.ts`

**Interfaces:**

- Consumes: `toReact`, `cssVarName` from `./react.js`; `SerializedNode` from `./tokens.js`.
- Produces: `generateCode(node, format): string` and the `CodeFormat = "react" | "html" | "css" | "json"` type. Task 6 imports both from `./codegen/index.js`.

- [ ] **Step 1: Write the failing test**

_server/src/codegen/index.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import card from "./fixtures/card.json" with { type: "json" };
import { generateCode } from "./index.js";
import type { SerializedNode } from "./tokens.js";

const tree = card as unknown as SerializedNode;

describe("generateCode", () => {
  test("react is the same output the react module produces", () => {
    expect(generateCode(tree, "react")).toContain("<div className=");
  });

  test("html emits class attributes rather than className", () => {
    const html = generateCode(tree, "html");
    expect(html).toContain("<div class=");
    expect(html).not.toContain("className");
  });

  test("css emits one rule per named node and uses the token", () => {
    const css = generateCode(tree, "css");
    expect(css).toContain(".card {");
    expect(css).toContain("background: var(--color-surface);");
  });

  test("json round-trips the tree", () => {
    expect(JSON.parse(generateCode(tree, "json")).id).toBe("1:1");
  });

  test("rejects an unknown format by name", () => {
    expect(() => generateCode(tree, "swift" as never)).toThrow(/swift/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/codegen/index.test.ts`
Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Write the HTML generator**

_server/src/codegen/html.ts — create_

```ts
import { toReact } from "./react.js";
import type { SerializedNode } from "./tokens.js";

/**
 * Renders the React output as plain HTML.
 *
 * The two grammars differ in exactly three places for the subset we emit, so
 * deriving one from the other keeps a single structural code path — and means
 * a structural bug shows up in both tests, not one.
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
```

- [ ] **Step 4: Write the CSS generator**

_server/src/codegen/css.ts — create_

```ts
import { cssVarName } from "./react.js";
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
        fills?: Array<{ type?: string; hex?: string }>;
        autoLayout?: { direction?: string; gap?: number };
        padding?: { top: number; right: number; bottom: number; left: number };
        cornerRadius?: number | string;
      }
    | undefined;
  const out: string[] = [];

  const fill = styles?.fills?.[0];
  if (fill?.type === "SOLID") {
    const token = node.design?.boundVariables?.find((b) => b.property === "fills[0]")?.variableName;
    const value = token ? `var(${cssVarName(token)})` : fill.hex;
    if (value) out.push(`${node.type === "TEXT" ? "color" : "background"}: ${value};`);
  }

  if (styles?.autoLayout) {
    out.push("display: flex;");
    out.push(`flex-direction: ${styles.autoLayout.direction === "VERTICAL" ? "column" : "row"};`);
    if (styles.autoLayout.gap) out.push(`gap: ${styles.autoLayout.gap}px;`);
  }

  const padding = styles?.padding;
  if (padding) {
    out.push(`padding: ${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px;`);
  }

  if (typeof styles?.cornerRadius === "number" && styles.cornerRadius > 0) {
    out.push(`border-radius: ${styles.cornerRadius}px;`);
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
```

- [ ] **Step 5: Write the dispatcher**

_server/src/codegen/index.ts — create_

```ts
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
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `cd server && bun test src/codegen/`
Expected: PASS — 18 pass, 0 fail across tokens, react and index

- [ ] **Step 7: Commit**

```bash
git add server/src/codegen/index.ts server/src/codegen/html.ts server/src/codegen/css.ts server/src/codegen/index.test.ts
git commit -m "feat(server): add HTML and CSS codegen behind a format dispatcher"
```

---

### Task 5: Export assets to disk [R24]

The official server hands back asset URLs that expire in about a week. We write files instead, because a committed file is what an agent actually needs when the code it writes will outlive the session. The response has to say so, or the agent will hand-draw an `<svg>` it has no vector data for.

**Files:**

- Create: `server/src/assets.ts`
- Create: `server/src/assets.test.ts`

**Interfaces:**

- Consumes: `ScreenshotSender` from `./tools.js`; `SerializedNode` from `./codegen/tokens.js`.
- Produces: `findExportableNodes(root): string[]` and `exportAssets(sender, nodeIds, outputDir, fileKey): Promise<AssetRecord[]>`, plus the `AssetRecord` type. Task 6 imports them from `./assets.js`.

- [ ] **Step 1: Write the failing test**

Only `findExportableNodes` is unit-tested here — it is the part with judgement in it. `exportAssets` is I/O over the bridge and is proven in task 7's manual pass.

_server/src/assets.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { findExportableNodes } from "./assets.js";
import type { SerializedNode } from "./codegen/tokens.js";

const tree = {
  id: "1:1",
  name: "Screen",
  type: "FRAME",
  children: [
    { id: "1:2", name: "icon/search", type: "VECTOR" },
    {
      id: "1:3",
      name: "Hero",
      type: "RECTANGLE",
      styles: { fills: [{ type: "IMAGE", imageHash: "abc" }] },
    },
    { id: "1:4", name: "Title", type: "TEXT" },
    {
      id: "1:5",
      name: "Logo",
      type: "GROUP",
      children: [{ id: "1:6", name: "path", type: "VECTOR" }],
    },
  ],
} as unknown as SerializedNode;

describe("findExportableNodes", () => {
  test("finds vectors and image-filled nodes", () => {
    expect(findExportableNodes(tree)).toContain("1:2");
    expect(findExportableNodes(tree)).toContain("1:3");
  });

  test("skips text", () => {
    expect(findExportableNodes(tree)).not.toContain("1:4");
  });

  test("exports a vector group whole rather than its paths", () => {
    const ids = findExportableNodes(tree);
    expect(ids).toContain("1:5");
    expect(ids).not.toContain("1:6");
  });

  test("returns an empty list for a tree with nothing to export", () => {
    expect(
      findExportableNodes({ id: "2:1", name: "Plain", type: "FRAME" } as SerializedNode)
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/assets.test.ts`
Expected: FAIL — `Cannot find module './assets.js'`

- [ ] **Step 3: Write the implementation**

_server/src/assets.ts — create_

```ts
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SerializedNode } from "./codegen/tokens.js";
import type { ScreenshotSender } from "./tools.js";

export interface AssetRecord {
  nodeId: string;
  nodeName: string;
  /** Path relative to the MCP server's working directory. */
  file: string;
  format: "SVG" | "PNG";
  bytes: number;
}

const VECTOR_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);

const hasImageFill = (node: SerializedNode): boolean => {
  const fills = (node.styles as { fills?: Array<{ type?: string }> } | undefined)?.fills;
  return Array.isArray(fills) && fills.some((fill) => fill.type === "IMAGE");
};

/**
 * Finds the nodes worth exporting as files.
 *
 * A vector group is exported whole — descending into its paths would produce a
 * pile of fragments no agent can reassemble — so the walk stops at the first
 * exportable ancestor.
 * @param root - The serialized root.
 * @returns Node ids, in document order.
 */
export const findExportableNodes = (root: SerializedNode): string[] => {
  const ids: string[] = [];

  const walk = (node: SerializedNode): void => {
    const children = node.children ?? [];
    const isVectorGroup =
      (node.type === "GROUP" || node.type === "FRAME") &&
      children.length > 0 &&
      children.every((child) => VECTOR_TYPES.has(child.type));

    if (VECTOR_TYPES.has(node.type) || hasImageFill(node) || isVectorGroup) {
      ids.push(node.id);
      return;
    }

    for (const child of children) walk(child);
  };

  walk(root);
  return ids;
};

/** Makes a filesystem-safe stem from a layer name. */
const fileStem = (name: string, nodeId: string): string => {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[\s/_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
  return base ? `${base}-${nodeId.replace(/[^a-z0-9]/gi, "")}` : nodeId.replace(/[^a-z0-9]/gi, "");
};

/**
 * Exports nodes to files under `outputDir` and returns their relative paths.
 *
 * `outputDir` must resolve inside the MCP server's working directory, matching
 * the containment `import_html_layers` and `save_screenshots` enforce.
 * @throws When `outputDir` escapes the working directory.
 */
export const exportAssets = async (
  sender: ScreenshotSender,
  nodeIds: string[],
  outputDir: string,
  fileKey?: string
): Promise<AssetRecord[]> => {
  if (nodeIds.length === 0) return [];

  const root = await realpath(process.cwd());
  const target = path.resolve(root, outputDir);
  await mkdir(target, { recursive: true });
  const resolved = await realpath(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(
      `assetDir "${outputDir}" resolves outside the MCP server working directory (${root}). ` +
        `Choose a directory inside the workspace.`
    );
  }

  const response = await sender.sendWithParams(
    "get_screenshot",
    nodeIds,
    { format: "SVG", clip: true },
    fileKey
  );
  if (response.error) throw new Error(response.error);

  const exports = (
    response.data as { exports?: Array<{ nodeId: string; nodeName: string; base64: string }> }
  )?.exports;
  if (!Array.isArray(exports)) return [];

  const records: AssetRecord[] = [];
  for (const item of exports) {
    const bytes = Buffer.from(item.base64, "base64");
    const file = `${fileStem(item.nodeName, item.nodeId)}.svg`;
    await writeFile(path.join(resolved, file), bytes);
    records.push({
      nodeId: item.nodeId,
      nodeName: item.nodeName,
      file: path.relative(root, path.join(resolved, file)).split(path.sep).join("/"),
      format: "SVG",
      bytes: bytes.length,
    });
  }
  return records;
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/assets.test.ts`
Expected: PASS — 4 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add server/src/assets.ts server/src/assets.test.ts
git commit -m "feat(server): export design assets to files inside the workspace"
```

---

### Task 6: Rewire get_design_context [R20, R25, R26]

Everything above is inert until the tool composes it. This is also where the response's own prose has to do real work: telling the agent which hint source it used per node, and that the exported files are the icons — not a suggestion to draw them.

**Files:**

- Modify: `server/src/schema.ts` — `toolInputSchemas.get_design_context` (currently lines 617-624) and its `rpcToArgs` entry
- Modify: `server/src/tools.ts` — the `get_design_context` handler
- Modify: `plugin/src/main/code.ts` — the `get_design_context` case, to honour a `nodeId` parameter
- Create: `server/src/design-context.test.ts`

**Interfaces:**

- Consumes: `generateCode`, `CODE_FORMATS` from `./codegen/index.js`; `collectTokens` from `./codegen/tokens.js`; `exportAssets`, `findExportableNodes` from `./assets.js`; `imageBlock`, `textBlock` from `./content.js`.
- Produces: `composeDesignContext(input): ContentBlock[]` exported from `server/src/tools.ts` for testing.

- [ ] **Step 1: Widen the input schema**

In `server/src/schema.ts`, replace the `get_design_context` entry:

```ts
  get_design_context: z.object({
    nodeId: createFigmaNodeIdSchema()
      .optional()
      .describe(
        "Node to describe. When omitted, uses the current selection, falling back to the current page."
      ),
    depth: z
      .number()
      .optional()
      .describe("How many levels deep to traverse the node tree (default 2)"),
    format: z
      .enum(["react", "html", "css", "json"])
      .optional()
      .describe("Reference code format (default react)"),
    assetDir: z
      .string()
      .optional()
      .describe(
        "Directory, relative to the MCP server working directory, to export icons and images into. Omit to skip asset export."
      ),
    fileKey: fileKeyField,
  }),
```

The existing `rpcToArgs.get_design_context` entry — `(_nodeIds, params) => ({ ...params })` — already forwards every field, so it needs no change. Confirm it is still there rather than assuming it.

- [ ] **Step 2: Write the failing test for the composer**

_server/src/design-context.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { composeDesignContext } from "./tools.js";
import type { SerializedNode } from "./codegen/tokens.js";

const tree = {
  id: "1:1",
  name: "Card",
  type: "FRAME",
  styles: { fills: [{ type: "SOLID", hex: "#101820" }] },
  design: {
    boundVariables: [{ property: "fills[0]", variableId: "V:1", variableName: "color/surface" }],
  },
} as unknown as SerializedNode;

describe("composeDesignContext", () => {
  test("puts the code and the tokens in a text block", () => {
    const [first] = composeDesignContext({ tree, format: "react", assets: [] });
    expect(first.type).toBe("text");
    expect((first as { text: string }).text).toContain("var(--color-surface)");
    expect((first as { text: string }).text).toContain("color/surface");
  });

  test("adds an image block when a screenshot is supplied", () => {
    const blocks = composeDesignContext({
      tree,
      format: "react",
      assets: [],
      screenshot: { base64: "AAAA", format: "PNG" },
    });
    expect(blocks.some((block) => block.type === "image")).toBe(true);
  });

  test("tells the agent to use exported files rather than draw icons", () => {
    const [first] = composeDesignContext({
      tree,
      format: "react",
      assets: [
        {
          nodeId: "1:2",
          nodeName: "icon/search",
          file: "assets/icon-search.svg",
          format: "SVG",
          bytes: 120,
        },
      ],
    });
    const text = (first as { text: string }).text;
    expect(text).toContain("assets/icon-search.svg");
    expect(text).toMatch(/do not hand-write/i);
  });

  test("flags truncation instead of returning an oversized block", () => {
    const wide = {
      ...tree,
      children: Array.from({ length: 5000 }, (_, i) => ({ ...tree, id: `9:${i}` })),
    };
    const [first] = composeDesignContext({
      tree: wide as SerializedNode,
      format: "react",
      assets: [],
    });
    expect((first as { text: string }).text).toContain("[truncated");
  });
});
```

- [ ] **Step 3: Write the composer**

Add to `server/src/tools.ts`, above `registerTools`. Exported so the test can reach it without standing up a server.

```ts
const MAX_CONTEXT_CHARS = 200_000;

export interface DesignContextInput {
  tree: SerializedNode;
  format: CodeFormat;
  assets: AssetRecord[];
  screenshot?: { base64: string; format: ExportFormat };
}

/**
 * Assembles the design-context response: reference code, the tokens the design
 * uses, the exported asset paths, and the screenshot.
 * @param input - The serialized tree plus everything gathered around it.
 * @returns MCP content blocks, text first.
 */
export function composeDesignContext(input: DesignContextInput): ContentBlock[] {
  const tokens = collectTokens(input.tree);
  const sections: string[] = [];

  sections.push(
    `## Reference code (${input.format})\n\nAdapt this to the target project's stack — it is a reference, not final code.\n\n\`\`\`\n${generateCode(input.tree, input.format)}\n\`\`\``
  );

  if (tokens.length > 0) {
    const rows = tokens
      .map(
        (token) =>
          `- \`${token.name}\` (${token.kind}, ${token.property}) — used by ${token.usedBy.length} node(s)`
      )
      .join("\n");
    sections.push(
      `## Design tokens\n\nMap these to the project's token system. Values bound to a token are emitted as \`var(--token)\`; a raw value in the code means nothing was bound.\n\n${rows}`
    );
  }

  if (input.assets.length > 0) {
    const rows = input.assets
      .map((asset) => `- \`${asset.file}\` — ${asset.nodeName} (${asset.nodeId})`)
      .join("\n");
    sections.push(
      `## Exported assets\n\nThese files are the real vector data. Reference them; do not hand-write \`<svg>\` markup, and do not substitute a same-named icon from the project unless the glyph clearly matches.\n\n${rows}`
    );
  }

  let text = sections.join("\n\n");
  if (text.length > MAX_CONTEXT_CHARS) {
    text = `${text.slice(0, MAX_CONTEXT_CHARS)}\n\n[truncated at ${MAX_CONTEXT_CHARS} characters — request a smaller node or a lower depth]`;
  }

  const blocks: ContentBlock[] = [textBlock(text)];
  if (input.screenshot) {
    const image = imageBlock(input.screenshot.base64, input.screenshot.format);
    if (image) blocks.push(image);
  }
  return blocks;
}
```

- [ ] **Step 4: Run the composer tests**

Run: `cd server && bun test src/design-context.test.ts`
Expected: PASS — 4 pass, 0 fail

- [ ] **Step 5: Honour nodeId in the plugin**

In `plugin/src/main/code.ts`, inside the `get_design_context` case, replace the selection lookup so an explicit node wins:

```ts
const requestedId = request.params?.nodeId;
const requested =
  typeof requestedId === "string" ? await figma.getNodeByIdAsync(requestedId) : null;
if (typeof requestedId === "string" && !requested) {
  throw new Error(`Node ${requestedId} not found in this file.`);
}

const selection = figma.currentPage.selection;
const contextNodes = requested
  ? [await serializeWithDepth(requested as SceneNode, 0)]
  : selection.length > 0
    ? await Promise.all(selection.map((node) => serializeWithDepth(node, 0)))
    : [await serializeWithDepth(figma.currentPage as unknown as SceneNode, 0)];
```

Add `nodeId?: string;` to `ServerRequestParams` in the same file.

- [ ] **Step 6: Rewrite the tool handler**

Replace the `get_design_context` registration in `server/src/tools.ts`:

```ts
server.tool(
  "get_design_context",
  "Get everything needed to implement a Figma node as code: reference code in the requested format, the design tokens it uses, exported icon and image files, and a screenshot. Prefer this over get_document plus get_screenshot — one call returns the whole picture.",
  toolInputSchemas.get_design_context.shape,
  async ({ nodeId, depth, format, assetDir, fileKey }): Promise<ToolResult> => {
    try {
      const response = await node.sendWithParams(
        "get_design_context",
        undefined,
        { nodeId, depth },
        fileKey
      );
      if (response.error) {
        return { content: [textBlock(response.error)], isError: true };
      }

      const context = response.data as { context: SerializedNode[] };
      const tree = context.context[0];
      if (!tree) {
        return {
          content: [textBlock("Nothing to describe — select a node in Figma, or pass nodeId.")],
          isError: true,
        };
      }

      const assets = assetDir
        ? await exportAssets(
            { sendWithParams: (t, ids, params, key) => node.sendWithParams(t, ids, params, key) },
            findExportableNodes(tree),
            assetDir,
            fileKey
          )
        : [];

      const shot = await node.sendWithParams(
        "get_screenshot",
        [tree.id],
        { format: "PNG", scale: 2, clip: true },
        fileKey
      );
      const first = (shot.data as { exports?: Array<{ base64: string }> })?.exports?.[0];

      return {
        content: composeDesignContext({
          tree,
          format: format ?? "react",
          assets,
          screenshot: first ? { base64: first.base64, format: "PNG" } : undefined,
        }),
      };
    } catch (err) {
      return {
        content: [textBlock(err instanceof Error ? err.message : String(err))],
        isError: true,
      };
    }
  }
);
```

- [ ] **Step 7: Verify the server builds and the suite is green**

Run: `cd server && bun run build && bun run test`
Expected: PASS — no `tsc` errors, all tests pass

- [ ] **Step 8: Commit**

```bash
git add server/src/schema.ts server/src/tools.ts server/src/design-context.test.ts plugin/src/main/code.ts
git commit -m "feat: get_design_context returns code, tokens, assets and a screenshot"
```

---

### Task 7: Verify in Figma and document

The composer is unit-tested against a fixture. What is not yet proven is that a real MCP client renders the image block, that assets land where the caller asked, and that a large frame truncates rather than hanging.

**Files:**

- Modify: `README.md` — the `get_design_context` row and Editing Notes
- Create: `docs/design-context.md` — the response contract

**Interfaces:**

- Consumes: the shipped tool.
- Produces: documentation only.

- [ ] **Step 1: Build and load**

```bash
cd server && bun run build
cd ../plugin && bun run build
```

Import `plugin/manifest.json` in Figma, open a design file with a real screen in it, and point your MCP client at `node /path/to/figma-design-relay/server/dist/index.js`.

- [ ] **Step 2: Prove the one-call response**

Select a card or list item and call `get_design_context` with no arguments.

Expected: one text block containing React reference code and a token list, plus a **rendered image** of the node — not a base64 string.

- [ ] **Step 3: Prove tokens beat hexes**

Pick a node whose fill is bound to a colour variable and call `get_design_context` on it by `nodeId`.

Expected: the code contains `var(--…)` for that fill and the hex appears nowhere in the generated code.

- [ ] **Step 4: Prove asset export**

Call `get_design_context` with `assetDir: "tmp-assets"` on a frame containing icons.

Expected: `tmp-assets/` fills with `.svg` files, the response lists their workspace-relative paths, and the text tells the agent not to hand-write `<svg>`.

- [ ] **Step 5: Prove containment**

Call it again with `assetDir: "../escape"`.

Expected: an error naming the working directory and refusing — no file is written outside the workspace.

- [ ] **Step 6: Prove the formats**

Call the tool three more times with `format` set to `html`, `css` and `json`.

Expected: each returns the corresponding output; an unknown format is rejected with a message listing the four supported ones.

- [ ] **Step 7: Prove bounded degradation**

Call it on a whole page with `depth: 6`.

Expected: a response that either fits or ends in `[truncated at 200000 characters …]`. It must not hang or return an unusable wall.

- [ ] **Step 8: Clean up**

```bash
rm -rf tmp-assets
```

- [ ] **Step 9: Write the response contract**

Create `docs/design-context.md` covering: the parameters (`nodeId`, `depth`, `format`, `assetDir`, `fileKey`); the block order (text first, image second); the section order inside the text block; the hint priority from R25; the token-over-value rule; the asset contract and why local files are preferred to expiring URLs; and the limits (depth, 200000 characters, the bridge's three-minute timeout).

- [ ] **Step 10: Update the README**

Replace the `get_design_context` row in the tool table:

```markdown
| `get_design_context` | Reference code, design tokens, exported assets and a screenshot for a node — one call ([guide](docs/design-context.md)) |
```

And append to Editing Notes:

```markdown
- `get_design_context` exports icons and images as files under `assetDir` rather than returning expiring URLs, because a committed file is what code you keep actually needs. The path must stay inside the MCP server working directory.
```

- [ ] **Step 11: Format and run everything**

```bash
bun run format
cd server && bun run test && bun run build
cd ../plugin && bun run test && bun run build
```

Expected: PASS — Prettier reports no remaining changes on a second run, both suites green, both builds clean

- [ ] **Step 12: Commit**

```bash
git add README.md docs/design-context.md
git commit -m "docs: document the design-context response contract"
```

---

## Done when

- `bun test` is green in `server/`, covering content blocks, tokens, React, the format dispatcher, assets and the composer.
- `bun run build` succeeds in both packages.
- In a real Figma file, one `get_design_context` call returns reference code, a token list and a rendered screenshot; a token-bound fill emits `var(--…)` and never its hex.
- `assetDir` writes real SVG files inside the workspace and refuses a path that escapes it.
- All four formats work and an unknown format is rejected by name.
- `docs/design-context.md` documents the parameters, block order, hint priority and limits.
