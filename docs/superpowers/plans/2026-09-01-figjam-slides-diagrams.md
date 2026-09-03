# FigJam, Slides and Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the bridge past design files — read and write FigJam boards, read Slides, and render Mermaid source as a real FigJam diagram — without breaking a single thing that works in design files today.

**Architecture:** One line in the manifest opens three new editors, and everything hard follows from it: node types and APIs differ per editor, so the existing design-only gate is replaced by a capability table that knows which tool works where. FigJam gets its own serializer branch and a small write surface. Mermaid parsing and layout happen server-side in pure modules; the plugin only receives a laid-out graph and creates nodes from it.

**Tech Stack:** TypeScript, Bun (`bun test`), Zod, `@modelcontextprotocol/sdk`, Vite, the Figma Plugin API across design, FigJam and Slides.

**Spec:** `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md` — this plan implements that spec's **Phase 6** and its requirements R43–R50.

## Global Constraints

- Node `>=20.0.0`; Bun is the package manager and script runner throughout.
- The server is ESM with `"module": "Node16"`: **relative imports inside `server/src` must carry a `.js` extension**. Plugin sources use extensionless relative imports.
- Prettier 3.9.6 formats everything; a Husky `pre-commit` hook runs `lint-staged`.
- **Phase 1's test harness must already be in place**; this plan writes `bun test` files in both packages.
- **No regression in design files is the hard constraint of this phase.** Every existing tool must behave in `figma` exactly as it does today. Task 1 makes that a test rather than a hope.
- Editor differences are real API differences, not cosmetic: `figma.createPage()` does not exist in FigJam or Slides; `createSticky` and `createConnector` exist only in FigJam; slide nodes only in Slides. A tool used in the wrong editor is refused up front with a message naming the editor it needs.
- **New plugin modules must never reference the `figma` global** — they take what they need as parameters so they test under Bun.
- Mermaid support is a **fixed, documented subset**. Input outside it is refused by name; nothing is ever rendered approximately.
- Every new tool registers a Zod schema in `toolInputSchemas` **and** a mapper in `rpcToArgs`, in the same commit.
- Never reformat or restructure code outside the files each task lists.

---

### Task 1: The editor capability table [R44, R50]

`plugin/src/main/code.ts` gates writes with `EDIT_REQUEST_TYPES` plus `requireEditorMode`, which knows exactly one fact: Dev Mode is read-only. Three editors need more than one fact. This replaces the set with a table, and — because the risk of this phase is breaking design files — the table's first test is that every existing tool still works in `figma`.

**Files:**

- Create: `plugin/src/main/capabilities.ts`
- Create: `plugin/src/main/capabilities.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `CAPABILITIES`, `assertEditorSupports(tool, editor)` and the `EditorType` type. Task 2 wires `assertEditorSupports` into the dispatcher in place of `requireEditorMode`.

- [ ] **Step 1: Write the failing test**

The first test is the regression guard. It lists the design tools that exist today; if a later task narrows one of them by accident, this fails.

_plugin/src/main/capabilities.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { assertEditorSupports, CAPABILITIES } from "./capabilities";

const DESIGN_WRITES = [
  "set_node_visibility",
  "set_text_content",
  "set_text_properties",
  "set_node_properties",
  "set_solid_fill",
  "set_gradient_fill",
  "set_effects",
  "set_stroke_properties",
  "set_auto_layout",
  "create_page",
  "create_frame",
  "create_text",
  "create_shape",
  "create_image",
  "import_html_layers",
  "duplicate_nodes",
  "reparent_nodes",
  "group_nodes",
  "ungroup_node",
  "delete_nodes",
];

describe("design files keep working", () => {
  test("every existing write tool is allowed in the design editor", () => {
    for (const tool of DESIGN_WRITES) {
      expect(() => assertEditorSupports(tool, "figma")).not.toThrow();
    }
  });

  test("every existing write tool is still refused in Dev Mode", () => {
    for (const tool of DESIGN_WRITES) {
      expect(() => assertEditorSupports(tool, "dev")).toThrow();
    }
  });

  test("reads are allowed in every editor", () => {
    for (const editor of ["figma", "figjam", "slides", "dev"] as const) {
      expect(() => assertEditorSupports("get_document", editor)).not.toThrow();
      expect(() => assertEditorSupports("get_selection", editor)).not.toThrow();
    }
  });
});

describe("assertEditorSupports", () => {
  test("create_page is design-only, because the API does not exist elsewhere", () => {
    expect(() => assertEditorSupports("create_page", "figjam")).toThrow(/design/i);
    expect(() => assertEditorSupports("create_page", "slides")).toThrow(/design/i);
  });

  test("FigJam writes are refused in design files", () => {
    expect(() => assertEditorSupports("create_sticky", "figma")).toThrow(/figjam/i);
  });

  test("the message names the editor the caller is in and the one the tool needs", () => {
    expect(() => assertEditorSupports("create_sticky", "figma")).toThrow(
      /currently in the design editor/i
    );
  });

  test("an unknown tool is allowed rather than blocked", () => {
    expect(() => assertEditorSupports("some_future_tool", "figjam")).not.toThrow();
  });

  test("every capability lists at least one editor", () => {
    for (const [tool, capability] of Object.entries(CAPABILITIES)) {
      expect(capability.editors.length, `${tool} allows no editors`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/capabilities.test.ts`
Expected: FAIL — `Cannot find module './capabilities'`

- [ ] **Step 3: Write the implementation**

_plugin/src/main/capabilities.ts — create_

```ts
/**
 * Which tools work in which Figma editor.
 *
 * Before phase 6 the bridge knew one fact — Dev Mode is read-only — because it
 * only ran in design files. Opening FigJam and Slides makes editor differences
 * structural: `figma.createPage()` does not exist outside design files, sticky
 * notes and connectors exist only in FigJam, slide nodes only in Slides.
 *
 * Anything absent from this table is allowed everywhere. That keeps read tools
 * and future additions working by default; only genuine restrictions are listed.
 */

export type EditorType = "figma" | "figjam" | "slides" | "dev";

export interface Capability {
  editors: EditorType[];
  /** Appended to the refusal so the caller learns why, not just that. */
  reason?: string;
}

const EDITOR_LABEL: Record<EditorType, string> = {
  figma: "design editor",
  figjam: "FigJam",
  slides: "Slides",
  dev: "Dev Mode",
};

/** Editors that can be written to at all. Dev Mode never can. */
const EDITABLE: EditorType[] = ["figma", "figjam", "slides"];

const DESIGN_ONLY: EditorType[] = ["figma"];
const FIGJAM_ONLY: EditorType[] = ["figjam"];

const designWrite = (reason?: string): Capability => ({ editors: DESIGN_ONLY, reason });

export const CAPABILITIES: Record<string, Capability> = {
  // Design writes. Every one of these existed before phase 6 and must keep
  // behaving identically in `figma` — see the regression test.
  set_node_visibility: { editors: EDITABLE },
  set_text_content: { editors: EDITABLE },
  set_text_properties: designWrite(),
  set_node_properties: { editors: EDITABLE },
  set_solid_fill: { editors: EDITABLE },
  set_gradient_fill: designWrite(),
  set_effects: designWrite(),
  set_stroke_properties: designWrite(),
  set_auto_layout: designWrite(),
  create_page: designWrite("figma.createPage() does not exist outside design files"),
  create_frame: designWrite(),
  create_text: { editors: EDITABLE },
  create_shape: designWrite(),
  create_image: designWrite(),
  import_html_layers: designWrite(),
  duplicate_nodes: { editors: EDITABLE },
  reparent_nodes: { editors: EDITABLE },
  group_nodes: { editors: EDITABLE },
  ungroup_node: { editors: EDITABLE },
  delete_nodes: { editors: EDITABLE },
  run_script: { editors: EDITABLE },
  import_library_asset: designWrite(),

  // Motion, design only.
  apply_animation_style: designWrite(),
  remove_animation_style: designWrite(),
  apply_manual_keyframe_track: designWrite(),
  remove_manual_keyframe_track: designWrite(),
  set_timeline_duration: designWrite(),

  // FigJam only.
  create_sticky: { editors: FIGJAM_ONLY, reason: "sticky notes exist only in FigJam" },
  create_connector: { editors: FIGJAM_ONLY, reason: "connectors exist only in FigJam" },
  create_shape_with_text: {
    editors: FIGJAM_ONLY,
    reason: "shapes-with-text exist only in FigJam",
  },
  create_section: { editors: ["figma", "figjam"] },
  generate_diagram: { editors: FIGJAM_ONLY, reason: "diagrams are rendered as FigJam boards" },
};

/**
 * Refuses a tool the current editor cannot run.
 * @param tool - The request type.
 * @param editor - `figma.editorType`.
 * @throws When the tool is listed and the editor is not among its editors.
 */
export const assertEditorSupports = (tool: string, editor: EditorType): void => {
  const capability = CAPABILITIES[tool];
  if (!capability) return;
  if (capability.editors.includes(editor)) return;

  const wanted = capability.editors.map((allowed) => EDITOR_LABEL[allowed]).join(" or ");
  const because = capability.reason ? ` (${capability.reason})` : "";
  const devNote =
    editor === "dev" ? " Dev Mode is read-only; switch to the design editor and re-run." : "";

  throw new Error(
    `${tool} requires ${wanted}${because}, but the plugin is currently in the ${EDITOR_LABEL[editor]}.${devNote}`
  );
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/capabilities.test.ts`
Expected: PASS — 8 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/capabilities.ts plugin/src/main/capabilities.test.ts
git commit -m "feat(plugin): add an editor capability table"
```

---

### Task 2: Open the other editors [R43]

One manifest line, one dispatcher change, and a status field so the UI and the agent both know which editor they are in.

**Files:**

- Modify: `plugin/manifest.json` — `editorType`
- Modify: `plugin/src/main/code.ts` — replace `EDIT_REQUEST_TYPES` and `requireEditorMode` with the capability check; add `editorType` to the status payload
- Modify: `server/src/tools.ts` — surface `editorType` in `list_files`

**Interfaces:**

- Consumes: `assertEditorSupports`, `EditorType` from `./capabilities`.
- Produces: the dispatcher refuses unsupported tools up front; `get_metadata` and the plugin status both carry `editorType`.

- [ ] **Step 1: Open the manifest**

```json
  "editorType": ["figma", "figjam", "slides", "dev"],
```

- [ ] **Step 2: Replace the gate in the dispatcher**

Delete the `EDIT_REQUEST_TYPES` set and the `requireEditorMode` function from `plugin/src/main/code.ts`, import the capability check, and replace the guard at the top of `handleRequest`:

```ts
import { assertEditorSupports, type EditorType } from "./capabilities";

// ... inside handleRequest, replacing the EDIT_REQUEST_TYPES check:
assertEditorSupports(request.type, figma.editorType as EditorType);
```

- [ ] **Step 3: Report the editor**

Add `editorType` to the `sendStatus` payload and to the `get_metadata` response, so an agent can see which editor it is talking to before it picks a tool:

```ts
const sendStatus = () => {
  figma.ui.postMessage({
    type: "plugin-status",
    payload: {
      fileName: figma.root.name,
      fileKey: getFileKey(),
      editorType: figma.editorType,
      selectionCount: figma.currentPage.selection.length,
    },
  });
};
```

In the `get_metadata` case, add `editorType: figma.editorType,` alongside `fileName`.

- [ ] **Step 4: Verify design files are unchanged**

Run: `cd plugin && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS — the regression tests from task 1 pass, no type errors, clean build

Then, in a **design** file, run the plugin and call `get_document`, `create_frame`, `set_solid_fill` and `delete_nodes`.

Expected: identical behaviour to before this phase. If anything is refused, the capability table is wrong — fix the table, not the caller.

- [ ] **Step 5: Verify the new editors connect**

Open a FigJam board (`figma.com/board/...`) and a Slides file (`figma.com/slides/...`), run the plugin in each, and call `list_files` and `get_metadata`.

Expected: both appear as connected files, each reporting its own `editorType`.

- [ ] **Step 6: Verify a cross-editor refusal**

In the FigJam board, call `create_page`.

Expected: `create_page requires design editor (figma.createPage() does not exist outside design files), but the plugin is currently in FigJam.`

- [ ] **Step 7: Commit**

```bash
git add plugin/manifest.json plugin/src/main/code.ts server/src/tools.ts
git commit -m "feat(plugin): support FigJam and Slides editors behind the capability table"
```

---

### Task 3: Read FigJam boards [R45]

A FigJam board is stickies, connectors and shapes-with-text. Connectors are the interesting case: without their endpoints, a serialized board is a pile of shapes with no topology, which is exactly the information a diagram is made of.

**Files:**

- Create: `plugin/src/main/figjam-serializer.ts`
- Create: `plugin/src/main/figjam-serializer.test.ts`
- Modify: `plugin/src/main/serializer.ts` — delegate FigJam node types

**Interfaces:**

- Consumes: nothing.
- Produces: `serializeFigJamNode(node): FigJamFields | undefined` and the `FigJamFields` type. `serializer.ts` merges the result into the base node.

- [ ] **Step 1: Write the failing test**

_plugin/src/main/figjam-serializer.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { serializeFigJamNode } from "./figjam-serializer";

describe("serializeFigJamNode", () => {
  test("returns undefined for a design node", () => {
    expect(serializeFigJamNode({ type: "RECTANGLE" })).toBeUndefined();
  });

  test("keeps a sticky's text and author colour", () => {
    expect(
      serializeFigJamNode({
        type: "STICKY",
        text: { characters: "Ship it" },
        authorVisible: true,
        authorName: "Sam",
      })
    ).toEqual({ text: "Ship it", authorName: "Sam" });
  });

  test("keeps a connector's endpoints so topology survives", () => {
    expect(
      serializeFigJamNode({
        type: "CONNECTOR",
        connectorStart: { endpointNodeId: "1:1", magnet: "AUTO" },
        connectorEnd: { endpointNodeId: "1:2", magnet: "AUTO" },
        connectorLineType: "ELBOWED",
        text: { characters: "then" },
      })
    ).toEqual({
      text: "then",
      connector: { from: "1:1", to: "1:2", lineType: "ELBOWED" },
    });
  });

  test("keeps a free-floating connector endpoint as a position", () => {
    const out = serializeFigJamNode({
      type: "CONNECTOR",
      connectorStart: { position: { x: 10, y: 20 } },
      connectorEnd: { endpointNodeId: "1:2" },
    });
    expect(out?.connector).toEqual({ from: null, to: "1:2", lineType: undefined });
  });

  test("keeps a shape-with-text's shape and text", () => {
    expect(
      serializeFigJamNode({
        type: "SHAPE_WITH_TEXT",
        shapeType: "DIAMOND",
        text: { characters: "OK?" },
      })
    ).toEqual({ text: "OK?", shapeType: "DIAMOND" });
  });

  test("keeps a code block's language", () => {
    expect(
      serializeFigJamNode({ type: "CODE_BLOCK", code: "const a = 1;", codeLanguage: "TYPESCRIPT" })
    ).toEqual({ text: "const a = 1;", codeLanguage: "TYPESCRIPT" });
  });

  test("keeps a table's cell text", () => {
    const out = serializeFigJamNode({
      type: "TABLE",
      numRows: 1,
      numColumns: 2,
      cellAt: (row: number, column: number) => ({ text: { characters: `r${row}c${column}` } }),
    });
    expect(out?.table).toEqual([["r0c0", "r0c1"]]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/figjam-serializer.test.ts`
Expected: FAIL — `Cannot find module './figjam-serializer'`

- [ ] **Step 3: Write the implementation**

_plugin/src/main/figjam-serializer.ts — create_

```ts
/**
 * Serializes the node types that exist only in FigJam.
 *
 * Connector endpoints are the point of this module. Without them a board
 * serializes as unrelated shapes and every diagram loses its topology — which
 * is the only part of a diagram that carries meaning.
 */

export interface FigJamFields {
  text?: string;
  authorName?: string;
  shapeType?: string;
  codeLanguage?: string;
  connector?: {
    /** Endpoint node id, or null when the endpoint floats free. */
    from: string | null;
    to: string | null;
    lineType?: string;
  };
  table?: string[][];
}

type Raw = Record<string, unknown>;

const textOf = (node: Raw): string | undefined => {
  const text = node.text as { characters?: string } | undefined;
  return typeof text?.characters === "string" ? text.characters : undefined;
};

const endpointId = (endpoint: unknown): string | null => {
  const value = endpoint as { endpointNodeId?: string } | undefined;
  return typeof value?.endpointNodeId === "string" ? value.endpointNodeId : null;
};

/**
 * Extracts the FigJam-specific fields of a node.
 * @param node - The raw scene node.
 * @returns The fields, or undefined when the node is not a FigJam type.
 */
export const serializeFigJamNode = (node: Raw): FigJamFields | undefined => {
  switch (node.type) {
    case "STICKY": {
      const fields: FigJamFields = {};
      const text = textOf(node);
      if (text !== undefined) fields.text = text;
      if (node.authorVisible === true && typeof node.authorName === "string") {
        fields.authorName = node.authorName;
      }
      return fields;
    }

    case "CONNECTOR": {
      const fields: FigJamFields = {
        connector: {
          from: endpointId(node.connectorStart),
          to: endpointId(node.connectorEnd),
          lineType: typeof node.connectorLineType === "string" ? node.connectorLineType : undefined,
        },
      };
      const text = textOf(node);
      if (text !== undefined) fields.text = text;
      return fields;
    }

    case "SHAPE_WITH_TEXT": {
      const fields: FigJamFields = {};
      const text = textOf(node);
      if (text !== undefined) fields.text = text;
      if (typeof node.shapeType === "string") fields.shapeType = node.shapeType;
      return fields;
    }

    case "CODE_BLOCK": {
      const fields: FigJamFields = {};
      if (typeof node.code === "string") fields.text = node.code;
      if (typeof node.codeLanguage === "string") fields.codeLanguage = node.codeLanguage;
      return fields;
    }

    case "TABLE": {
      const rows = typeof node.numRows === "number" ? node.numRows : 0;
      const columns = typeof node.numColumns === "number" ? node.numColumns : 0;
      const cellAt = node.cellAt as ((r: number, c: number) => Raw) | undefined;
      if (!cellAt || rows === 0 || columns === 0) return {};
      const table: string[][] = [];
      for (let row = 0; row < rows; row++) {
        const line: string[] = [];
        for (let column = 0; column < columns; column++) {
          line.push(textOf(cellAt(row, column)) ?? "");
        }
        table.push(line);
      }
      return { table };
    }

    default:
      return undefined;
  }
};
```

- [ ] **Step 4: Delegate from the main serializer**

In `plugin/src/main/serializer.ts`, import the module and merge its result into the base node before the TEXT and children branches:

```ts
import { serializeFigJamNode } from "./figjam-serializer";

// ... inside serializeNode, after the intent fields:
const figjam = serializeFigJamNode(raw);
if (figjam && Object.keys(figjam).length > 0) Object.assign(base, figjam);
```

Add the `FigJamFields` members to `SerializedNode` as optional fields so the type stays honest.

- [ ] **Step 5: Run the tests and build**

Run: `cd plugin && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS — 7 new tests green, no type errors, clean build

- [ ] **Step 6: Prove it on a real board**

In a FigJam board with two stickies joined by a labelled connector, call `get_document`.

Expected: both stickies carry their text; the connector carries `connector.from` and `connector.to` matching the sticky ids, plus its label.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/figjam-serializer.ts plugin/src/main/figjam-serializer.test.ts plugin/src/main/serializer.ts
git commit -m "feat(plugin): serialize FigJam stickies, connectors and shapes"
```

---

### Task 4: Write to FigJam boards [R46]

Four creators, shaped exactly like the existing design write tools: validated Zod input, `fileKey` routing, node ids returned. FigJam text needs a font loaded just as design text does.

**Files:**

- Modify: `plugin/src/main/code.ts` — `RequestType` union, `ServerRequestParams`, four new cases
- Modify: `server/src/schema.ts` — four schemas and four `rpcToArgs` entries
- Modify: `server/src/tools.ts` — register four tools

**Interfaces:**

- Consumes: `assertEditorSupports` (already wired in task 2).
- Produces: bridge requests `create_sticky`, `create_shape_with_text`, `create_connector` and `create_section`, each returning `{ id, type }` for what it created. Task 7 reuses `create_shape_with_text` and `create_connector`.

- [ ] **Step 1: Add the params**

In `ServerRequestParams` in `plugin/src/main/code.ts`:

```ts
  text?: string;
  shapeType?: string;
  startNodeId?: string;
  endNodeId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
```

- [ ] **Step 2: Add the sticky and shape cases**

FigJam's default font is Inter; load it before setting characters, the same rule design text follows.

```ts
      case "create_sticky": {
        const sticky = figma.createSticky();
        await figma.loadFontAsync(sticky.text.fontName as FontName);
        if (typeof request.params?.text === "string") {
          sticky.text.characters = request.params.text;
        }
        if (typeof request.params?.x === "number") sticky.x = request.params.x;
        if (typeof request.params?.y === "number") sticky.y = request.params.y;
        return {
          type: request.type,
          requestId: request.requestId,
          data: { id: sticky.id, type: sticky.type },
        };
      }

      case "create_shape_with_text": {
        const shape = figma.createShapeWithText();
        if (typeof request.params?.shapeType === "string") {
          shape.shapeType = request.params.shapeType as ShapeWithText["shapeType"];
        }
        await figma.loadFontAsync(shape.text.fontName as FontName);
        if (typeof request.params?.text === "string") {
          shape.text.characters = request.params.text;
        }
        if (typeof request.params?.x === "number") shape.x = request.params.x;
        if (typeof request.params?.y === "number") shape.y = request.params.y;
        if (typeof request.params?.width === "number" && typeof request.params?.height === "number") {
          shape.resize(request.params.width, request.params.height);
        }
        return {
          type: request.type,
          requestId: request.requestId,
          data: { id: shape.id, type: shape.type },
        };
      }
```

- [ ] **Step 3: Add the connector and section cases**

A connector to a node that does not exist produces a confusing runtime failure, so check both endpoints first.

```ts
      case "create_connector": {
        const startId = request.params?.startNodeId;
        const endId = request.params?.endNodeId;
        if (typeof startId !== "string" || typeof endId !== "string") {
          throw new Error("create_connector requires `startNodeId` and `endNodeId`.");
        }
        for (const id of [startId, endId]) {
          if (!(await figma.getNodeByIdAsync(id))) {
            throw new Error(`Connector endpoint ${id} not found in this file.`);
          }
        }

        const connector = figma.createConnector();
        connector.connectorStart = { endpointNodeId: startId, magnet: "AUTO" };
        connector.connectorEnd = { endpointNodeId: endId, magnet: "AUTO" };
        if (typeof request.params?.text === "string" && request.params.text !== "") {
          await figma.loadFontAsync(connector.text.fontName as FontName);
          connector.text.characters = request.params.text;
        }
        return {
          type: request.type,
          requestId: request.requestId,
          data: { id: connector.id, type: connector.type },
        };
      }

      case "create_section": {
        const section = figma.createSection();
        if (typeof request.params?.name === "string") section.name = request.params.name;
        if (typeof request.params?.x === "number") section.x = request.params.x;
        if (typeof request.params?.y === "number") section.y = request.params.y;
        if (typeof request.params?.width === "number" && typeof request.params?.height === "number") {
          section.resizeWithoutConstraints(request.params.width, request.params.height);
        }
        return {
          type: request.type,
          requestId: request.requestId,
          data: { id: section.id, type: section.type },
        };
      }
```

- [ ] **Step 4: Add the schemas and mappers**

In `server/src/schema.ts`:

```ts
  create_sticky: z.object({
    text: z.string().describe("Sticky note text."),
    x: z.number().optional(),
    y: z.number().optional(),
    fileKey: fileKeyField,
  }),

  create_shape_with_text: z.object({
    text: z.string().describe("Text inside the shape."),
    shapeType: z
      .enum(["SQUARE", "ELLIPSE", "ROUNDED_RECTANGLE", "DIAMOND", "TRIANGLE_UP", "PARALLELOGRAM_RIGHT"])
      .optional()
      .describe("FigJam shape (default SQUARE)."),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    fileKey: fileKeyField,
  }),

  create_connector: z.object({
    startNodeId: createFigmaNodeIdSchema().describe("Node the connector starts at."),
    endNodeId: createFigmaNodeIdSchema().describe("Node the connector ends at."),
    text: z.string().optional().describe("Optional label on the connector."),
    fileKey: fileKeyField,
  }),

  create_section: z.object({
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    fileKey: fileKeyField,
  }),
```

Each gets a `rpcToArgs` entry of the form `(_nodeIds, params) => ({ ...params })`.

- [ ] **Step 5: Register the four tools**

Each is a `renderResponse(() => node.sendWithParams(...))` pass-through. Every description states the editor requirement in its first sentence, e.g.:

```ts
server.tool(
  "create_sticky",
  "Create a FigJam sticky note. FigJam boards only — rejected in design files, Slides and Dev Mode.",
  toolInputSchemas.create_sticky.shape,
  async ({ text, x, y, fileKey }): Promise<ToolResult> => {
    return renderResponse(() =>
      node.sendWithParams("create_sticky", undefined, { text, x, y }, fileKey)
    );
  }
);
```

- [ ] **Step 6: Verify and prove in FigJam**

Run: `cd server && bun run build && cd ../plugin && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS — no errors from either

Then in a FigJam board create two shapes-with-text and connect them.

Expected: both shapes appear with their text, and a connector joins them. Calling `create_sticky` in a **design** file is refused with the FigJam message from task 1.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/code.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat: add FigJam sticky, shape, connector and section tools"
```

---

### Task 5: Scope Slides deliberately [R47]

Slides gets reads and screenshots, and text edits inside existing slides. Creating slide structure is out of scope for this phase — and that has to be written down, because an unstated scope boundary reads as a bug.

**Files:**

- Modify: `plugin/src/main/capabilities.ts` — Slides entries
- Modify: `plugin/src/main/capabilities.test.ts` — Slides expectations
- Create: `docs/slides.md`

**Interfaces:**

- Consumes: the capability table from task 1.
- Produces: a documented Slides scope; no new tools.

- [ ] **Step 1: Write the failing test**

Append to `plugin/src/main/capabilities.test.ts`:

```ts
describe("slides scope", () => {
  test("reads and screenshots work", () => {
    expect(() => assertEditorSupports("get_document", "slides")).not.toThrow();
    expect(() => assertEditorSupports("get_screenshot", "slides")).not.toThrow();
  });

  test("text edits inside existing slides work", () => {
    expect(() => assertEditorSupports("set_text_content", "slides")).not.toThrow();
    expect(() => assertEditorSupports("set_node_properties", "slides")).not.toThrow();
  });

  test("creating design structure is out of scope", () => {
    expect(() => assertEditorSupports("create_frame", "slides")).toThrow(/design editor/i);
    expect(() => assertEditorSupports("create_page", "slides")).toThrow();
  });

  test("FigJam-only tools are refused", () => {
    expect(() => assertEditorSupports("create_sticky", "slides")).toThrow(/figjam/i);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd plugin && bun test src/main/capabilities.test.ts`
Expected: PASS — task 1's table already produces these outcomes. If any case fails, adjust the table's `EDITABLE` membership rather than special-casing Slides.

- [ ] **Step 3: Write the scope document**

Create `docs/slides.md` stating: what works (every read tool, `get_screenshot`, `save_screenshots`, and text and property edits on nodes inside existing slides); what does not and why (creating slides, slide rows and slide grids is deliberately unimplemented in phase 6 — the node types exist but the layout rules do not, and a half-working slide builder is worse than none); and how to check (`get_metadata` reports `editorType: "slides"`).

- [ ] **Step 4: Commit**

```bash
git add plugin/src/main/capabilities.test.ts docs/slides.md
git commit -m "docs: state the Slides support scope"
```

---

### Task 6: Parse a Mermaid subset [R48, R49]

Four diagram kinds, one intermediate representation, pure and server-side. Anything outside the subset is refused by name — an approximate diagram is worse than an error, because nobody checks a diagram they asked for.

**Files:**

- Create: `server/src/mermaid/parse.ts`
- Create: `server/src/mermaid/parse.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `parseMermaid(source): Diagram`, `SUPPORTED_DIAGRAMS`, and the `Diagram`, `DiagramNode`, `DiagramEdge`, `DiagramKind` types. Task 7 imports them from `./mermaid/parse.js`.

- [ ] **Step 1: Write the failing test**

_server/src/mermaid/parse.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { parseMermaid } from "./parse.js";

describe("flowchart", () => {
  const diagram = parseMermaid(`
flowchart TD
  A[Start] --> B{Ready?}
  B -->|yes| C(Ship)
  B -->|no| A
`);

  test("reads the kind and direction", () => {
    expect(diagram.kind).toBe("flowchart");
    expect(diagram.direction).toBe("TD");
  });

  test("reads nodes with their labels and shapes", () => {
    expect(diagram.nodes).toContainEqual({ id: "A", label: "Start", shape: "rect" });
    expect(diagram.nodes).toContainEqual({ id: "B", label: "Ready?", shape: "diamond" });
    expect(diagram.nodes).toContainEqual({ id: "C", label: "Ship", shape: "round" });
  });

  test("reads edges and their labels", () => {
    expect(diagram.edges).toContainEqual({ from: "B", to: "C", label: "yes", style: "solid" });
    expect(diagram.edges).toHaveLength(3);
  });

  test("declares each node once even when it appears twice", () => {
    expect(diagram.nodes.filter((node) => node.id === "A")).toHaveLength(1);
  });
});

describe("sequenceDiagram", () => {
  const diagram = parseMermaid(`
sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: GET /items
  S-->>U: 200 OK
`);

  test("reads participants with their aliases", () => {
    expect(diagram.nodes).toEqual([
      { id: "U", label: "User", shape: "actor" },
      { id: "S", label: "Server", shape: "actor" },
    ]);
  });

  test("reads messages, keeping dashed replies distinct", () => {
    expect(diagram.edges[0]).toEqual({ from: "U", to: "S", label: "GET /items", style: "solid" });
    expect(diagram.edges[1].style).toBe("dashed");
  });
});

describe("erDiagram", () => {
  const diagram = parseMermaid(`
erDiagram
  CUSTOMER ||--o{ ORDER : places
`);

  test("reads entities and the relationship label", () => {
    expect(diagram.nodes.map((node) => node.id)).toEqual(["CUSTOMER", "ORDER"]);
    expect(diagram.edges[0]).toEqual({
      from: "CUSTOMER",
      to: "ORDER",
      label: "places",
      style: "solid",
    });
  });
});

describe("stateDiagram", () => {
  const diagram = parseMermaid(`
stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> [*]
`);

  test("turns the start and end markers into distinct nodes", () => {
    const shapes = diagram.nodes.map((node) => node.shape);
    expect(shapes).toContain("start");
    expect(shapes).toContain("end");
  });

  test("reads the transition label", () => {
    expect(diagram.edges.find((edge) => edge.from === "Idle")?.label).toBe("start");
  });
});

describe("refusals", () => {
  test("names the unsupported diagram type and lists the supported ones", () => {
    expect(() => parseMermaid('pie title Votes\n  "a" : 10')).toThrow(/pie/);
    expect(() => parseMermaid("pie title Votes")).toThrow(/flowchart/);
  });

  test("refuses input with no recognisable header", () => {
    expect(() => parseMermaid("just some text")).toThrow(/could not determine/i);
  });

  test("refuses an empty diagram rather than rendering nothing", () => {
    expect(() => parseMermaid("flowchart TD")).toThrow(/no nodes/i);
  });

  test("ignores comments", () => {
    const diagram = parseMermaid("flowchart LR\n  %% a comment\n  A --> B");
    expect(diagram.nodes).toHaveLength(2);
    expect(diagram.direction).toBe("LR");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/mermaid/parse.test.ts`
Expected: FAIL — `Cannot find module './parse.js'`

- [ ] **Step 3: Write the implementation**

_server/src/mermaid/parse.ts — create_

```ts
/**
 * Parses the Mermaid subset the bridge renders into FigJam.
 *
 * Deliberately narrow. A diagram that renders approximately is worse than one
 * that refuses, because nobody proof-reads a diagram they asked a tool to draw
 * — so anything outside the subset throws, naming what it received.
 */

export type DiagramKind = "flowchart" | "sequence" | "er" | "state";

export type NodeShape =
  "rect" | "round" | "stadium" | "diamond" | "actor" | "entity" | "state" | "start" | "end";

export interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed";
}

export interface Diagram {
  kind: DiagramKind;
  direction: "TD" | "LR";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export const SUPPORTED_DIAGRAMS = "flowchart, sequenceDiagram, erDiagram, stateDiagram-v2";

const HEADERS: Array<[RegExp, DiagramKind]> = [
  [/^(?:flowchart|graph)\b/i, "flowchart"],
  [/^sequenceDiagram\b/i, "sequence"],
  [/^erDiagram\b/i, "er"],
  [/^stateDiagram(?:-v2)?\b/i, "state"],
];

/** Strips comments and blank lines, keeping statement order. */
const statementsOf = (source: string): string[] =>
  source
    .split("\n")
    .map((line) => line.replace(/%%.*$/, "").trim())
    .filter((line) => line !== "");

class Builder {
  private readonly order: string[] = [];
  private readonly nodes = new Map<string, DiagramNode>();
  readonly edges: DiagramEdge[] = [];

  /** Declares a node, keeping the first label and shape that named it. */
  node(id: string, label?: string, shape: NodeShape = "rect"): string {
    const existing = this.nodes.get(id);
    if (existing) {
      if (label && existing.label === existing.id) existing.label = label;
      return id;
    }
    this.order.push(id);
    this.nodes.set(id, { id, label: label ?? id, shape });
    return id;
  }

  edge(from: string, to: string, label?: string, style: "solid" | "dashed" = "solid"): void {
    const edge: DiagramEdge = { from, to, style };
    if (label) edge.label = label;
    this.edges.push(edge);
  }

  list(): DiagramNode[] {
    return this.order.map((id) => this.nodes.get(id) as DiagramNode);
  }
}

/** Reads `A[Label]`, `A(Label)`, `A([Label])`, `A{Label}` or a bare `A`. */
const readFlowNode = (raw: string, builder: Builder): string => {
  const text = raw.trim();
  const shaped = text.match(/^([A-Za-z0-9_.-]+)\s*(\(\[|\[|\(|\{)(.*?)(\]\)|\]|\)|\})$/);
  if (!shaped) return builder.node(text);

  const [, id, open, label] = shaped;
  const shape: NodeShape =
    open === "{" ? "diamond" : open === "([" ? "stadium" : open === "(" ? "round" : "rect";
  return builder.node(id, label.trim(), shape);
};

const parseFlowchart = (lines: string[], builder: Builder): void => {
  const EDGE = /^(.+?)\s*(-\.->|-->|---|==>)\s*(?:\|([^|]*)\|\s*)?(.+)$/;
  for (const line of lines) {
    const match = line.match(EDGE);
    if (!match) {
      if (/^[A-Za-z0-9_.-]+/.test(line)) readFlowNode(line, builder);
      continue;
    }
    const [, left, arrow, label, right] = match;
    const from = readFlowNode(left, builder);
    const to = readFlowNode(right, builder);
    builder.edge(from, to, label?.trim() || undefined, arrow === "-.->" ? "dashed" : "solid");
  }
};

const parseSequence = (lines: string[], builder: Builder): void => {
  const PARTICIPANT = /^(?:participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/i;
  const MESSAGE = /^([A-Za-z0-9_]+)\s*(--?>>?|--?x)\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/;

  for (const line of lines) {
    const participant = line.match(PARTICIPANT);
    if (participant) {
      builder.node(participant[1], participant[2]?.trim() ?? participant[1], "actor");
      continue;
    }
    const message = line.match(MESSAGE);
    if (!message) continue;
    const [, from, arrow, to, label] = message;
    builder.node(from, undefined, "actor");
    builder.node(to, undefined, "actor");
    builder.edge(from, to, label.trim() || undefined, arrow.startsWith("--") ? "dashed" : "solid");
  }
};

const parseEr = (lines: string[], builder: Builder): void => {
  const RELATION = /^([A-Za-z0-9_]+)\s+\S+\s+([A-Za-z0-9_]+)\s*:\s*(.*)$/;
  for (const line of lines) {
    const match = line.match(RELATION);
    if (!match) continue;
    const [, left, right, label] = match;
    builder.node(left, left, "entity");
    builder.node(right, right, "entity");
    builder.edge(left, right, label.trim().replace(/^"|"$/g, "") || undefined);
  }
};

const parseState = (lines: string[], builder: Builder): void => {
  const TRANSITION = /^(\[\*\]|[A-Za-z0-9_]+)\s*-->\s*(\[\*\]|[A-Za-z0-9_]+)(?:\s*:\s*(.*))?$/;
  let terminals = 0;

  const marker = (token: string, shape: NodeShape): string => {
    if (token !== "[*]") return builder.node(token, token, "state");
    terminals++;
    return builder.node(`__terminal_${terminals}`, shape === "start" ? "start" : "end", shape);
  };

  for (const line of lines) {
    const match = line.match(TRANSITION);
    if (!match) continue;
    const [, left, right, label] = match;
    const from = marker(left, "start");
    const to = marker(right, "end");
    builder.edge(from, to, label?.trim() || undefined);
  }
};

/**
 * Parses Mermaid source into the renderer's intermediate representation.
 * @param source - Mermaid text.
 * @throws When the diagram type is unsupported, unrecognisable, or empty.
 */
export const parseMermaid = (source: string): Diagram => {
  const lines = statementsOf(source);
  if (lines.length === 0) {
    throw new Error(`Empty diagram. Supported types: ${SUPPORTED_DIAGRAMS}.`);
  }

  const header = lines[0];
  const matched = HEADERS.find(([pattern]) => pattern.test(header));
  if (!matched) {
    const word = header.split(/\s+/)[0];
    throw new Error(
      /^[a-z]/i.test(word)
        ? `Unsupported diagram type "${word}". Supported types: ${SUPPORTED_DIAGRAMS}.`
        : `Could not determine the diagram type from "${header}". Supported types: ${SUPPORTED_DIAGRAMS}.`
    );
  }

  const [, kind] = matched;
  const direction = /\b(LR|RL)\b/i.test(header) ? "LR" : "TD";
  const builder = new Builder();
  const body = lines.slice(1);

  if (kind === "flowchart") parseFlowchart(body, builder);
  else if (kind === "sequence") parseSequence(body, builder);
  else if (kind === "er") parseEr(body, builder);
  else parseState(body, builder);

  const nodes = builder.list();
  if (nodes.length === 0) {
    throw new Error(
      `The ${kind} diagram declared no nodes. Check the syntax against the supported subset: ${SUPPORTED_DIAGRAMS}.`
    );
  }

  return { kind, direction, nodes, edges: builder.edges };
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/mermaid/parse.test.ts`
Expected: PASS — 14 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add server/src/mermaid/parse.ts server/src/mermaid/parse.test.ts
git commit -m "feat(server): parse a documented Mermaid subset"
```

---

### Task 7: Lay out and render the diagram [R48]

Layout is arithmetic, so it is pure and testable. Rendering is a single plugin request that takes an already-positioned graph — the plugin never does layout, which keeps the hard part in a place where a failing test can find it.

**Files:**

- Create: `server/src/mermaid/layout.ts`
- Create: `server/src/mermaid/layout.test.ts`
- Modify: `plugin/src/main/code.ts` — a `render_diagram` case
- Modify: `server/src/schema.ts` — `generate_diagram` schema and `rpcToArgs` entry
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: `Diagram`, `DiagramNode`, `DiagramEdge` from `./parse.js`.
- Produces: `layoutDiagram(diagram): PositionedDiagram` and the `PositionedNode`, `PositionedDiagram` types; a bridge request `render_diagram` with `params: { diagram }` returning `{ createdNodeIds }`.

- [ ] **Step 1: Write the failing test**

_server/src/mermaid/layout.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { layoutDiagram } from "./layout.js";
import { parseMermaid } from "./parse.js";

const flow = layoutDiagram(parseMermaid("flowchart TD\n A[Start] --> B[Middle]\n B --> C[End]"));

describe("layoutDiagram", () => {
  test("positions every node", () => {
    expect(flow.nodes).toHaveLength(3);
    expect(flow.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
      true
    );
  });

  test("stacks a top-down chain vertically without overlap", () => {
    const ys = flow.nodes.map((node) => node.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  test("places a left-right diagram horizontally instead", () => {
    const lr = layoutDiagram(parseMermaid("flowchart LR\n A --> B"));
    expect(lr.nodes[0].x).toBeLessThan(lr.nodes[1].x);
    expect(lr.nodes[0].y).toBe(lr.nodes[1].y);
  });

  test("puts siblings on the same rank side by side", () => {
    const fan = layoutDiagram(parseMermaid("flowchart TD\n A --> B\n A --> C"));
    const [, b, c] = fan.nodes;
    expect(b.y).toBe(c.y);
    expect(b.x).not.toBe(c.x);
  });

  test("lays sequence participants in a row", () => {
    const seq = layoutDiagram(parseMermaid("sequenceDiagram\n A->>B: hi\n B->>C: bye"));
    expect(new Set(seq.nodes.map((node) => node.y)).size).toBe(1);
  });

  test("reports a bounding box that contains every node", () => {
    const right = Math.max(...flow.nodes.map((node) => node.x + node.width));
    expect(flow.width).toBeGreaterThanOrEqual(right);
  });

  test("keeps every edge, including one that closes a cycle", () => {
    const cyclic = layoutDiagram(parseMermaid("flowchart TD\n A --> B\n B --> A"));
    expect(cyclic.edges).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/mermaid/layout.test.ts`
Expected: FAIL — `Cannot find module './layout.js'`

- [ ] **Step 3: Write the implementation**

_server/src/mermaid/layout.ts — create_

```ts
import type { Diagram, DiagramEdge, DiagramNode } from "./parse.js";

/**
 * Ranked layout for the supported diagram kinds.
 *
 * A node's rank is its longest distance from a root, computed over a
 * cycle-broken traversal — a cycle must not make layout hang, and a diagram
 * with one still has to draw.
 */

export interface PositionedNode extends DiagramNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedDiagram {
  kind: Diagram["kind"];
  nodes: PositionedNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const GAP_ALONG = 120;
const GAP_ACROSS = 60;

/** Longest-path ranking, with visited tracking so cycles terminate. */
const rankNodes = (nodes: DiagramNode[], edges: DiagramEdge[]): Map<string, number> => {
  const outgoing = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    hasIncoming.add(edge.to);
  }

  const rank = new Map<string, number>();
  const roots = nodes.filter((node) => !hasIncoming.has(node.id));
  const queue: Array<{ id: string; depth: number }> = (
    roots.length > 0 ? roots : nodes.slice(0, 1)
  ).map((node) => ({ id: node.id, depth: 0 }));
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift() as { id: string; depth: number };
    const key = `${id}@${depth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rank.set(id, Math.max(rank.get(id) ?? 0, depth));
    for (const next of outgoing.get(id) ?? []) {
      if (depth > nodes.length) continue;
      queue.push({ id: next, depth: depth + 1 });
    }
  }

  for (const node of nodes) if (!rank.has(node.id)) rank.set(node.id, 0);
  return rank;
};

/**
 * Assigns coordinates to every node in a parsed diagram.
 * @param diagram - The parsed diagram.
 * @returns Positioned nodes plus the bounding box that contains them.
 */
export const layoutDiagram = (diagram: Diagram): PositionedDiagram => {
  // Sequence diagrams are a single row of participants by definition.
  const ranks =
    diagram.kind === "sequence"
      ? new Map(diagram.nodes.map((node, index) => [node.id, index]))
      : rankNodes(diagram.nodes, diagram.edges);

  const horizontal = diagram.kind === "sequence" || diagram.direction === "LR";

  const byRank = new Map<number, DiagramNode[]>();
  for (const node of diagram.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    byRank.set(rank, [...(byRank.get(rank) ?? []), node]);
  }

  const positioned: PositionedNode[] = [];
  for (const [rank, group] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    group.forEach((node, index) => {
      const along = rank * (horizontal ? NODE_WIDTH + GAP_ALONG : NODE_HEIGHT + GAP_ALONG);
      const across = index * (horizontal ? NODE_HEIGHT + GAP_ACROSS : NODE_WIDTH + GAP_ACROSS);
      positioned.push({
        ...node,
        x: horizontal ? along : across,
        y: horizontal ? across : along,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }

  const order = new Map(diagram.nodes.map((node, index) => [node.id, index]));
  positioned.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    kind: diagram.kind,
    nodes: positioned,
    edges: diagram.edges,
    width: Math.max(...positioned.map((node) => node.x + node.width), NODE_WIDTH),
    height: Math.max(...positioned.map((node) => node.y + node.height), NODE_HEIGHT),
  };
};
```

- [ ] **Step 4: Run the layout tests**

Run: `cd server && bun test src/mermaid/layout.test.ts`
Expected: PASS — 7 pass, 0 fail

- [ ] **Step 5: Add the plugin renderer**

Add `"render_diagram"` to the `RequestType` union, `diagram?: unknown;` to `ServerRequestParams`, and the case. Shapes are created first so connectors have endpoints to attach to.

```ts
      case "render_diagram": {
        const diagram = request.params?.diagram as
          | {
              nodes: Array<{ id: string; label: string; shape: string; x: number; y: number; width: number; height: number }>;
              edges: Array<{ from: string; to: string; label?: string }>;
            }
          | undefined;
        if (!diagram || !Array.isArray(diagram.nodes)) {
          throw new Error("render_diagram requires a laid-out `diagram` parameter.");
        }

        const SHAPES: Record<string, ShapeWithText["shapeType"]> = {
          rect: "SQUARE",
          round: "ROUNDED_RECTANGLE",
          stadium: "ROUNDED_RECTANGLE",
          diamond: "DIAMOND",
          actor: "ROUNDED_RECTANGLE",
          entity: "SQUARE",
          state: "ROUNDED_RECTANGLE",
          start: "ELLIPSE",
          end: "ELLIPSE",
        };

        const created: string[] = [];
        const byId = new Map<string, SceneNode>();

        for (const node of diagram.nodes) {
          const shape = figma.createShapeWithText();
          shape.shapeType = SHAPES[node.shape] ?? "SQUARE";
          await figma.loadFontAsync(shape.text.fontName as FontName);
          shape.text.characters = node.label;
          shape.resize(node.width, node.height);
          shape.x = node.x;
          shape.y = node.y;
          byId.set(node.id, shape);
          created.push(shape.id);
        }

        for (const edge of diagram.edges) {
          const start = byId.get(edge.from);
          const end = byId.get(edge.to);
          if (!start || !end) continue;
          const connector = figma.createConnector();
          connector.connectorStart = { endpointNodeId: start.id, magnet: "AUTO" };
          connector.connectorEnd = { endpointNodeId: end.id, magnet: "AUTO" };
          if (edge.label) {
            await figma.loadFontAsync(connector.text.fontName as FontName);
            connector.text.characters = edge.label;
          }
          created.push(connector.id);
        }

        figma.currentPage.selection = [...byId.values()];
        figma.viewport.scrollAndZoomIntoView([...byId.values()]);

        return {
          type: request.type,
          requestId: request.requestId,
          data: { createdNodeIds: created, nodeCount: diagram.nodes.length },
        };
      }
```

- [ ] **Step 6: Add the schema, mapper and tool**

```ts
  generate_diagram: z.object({
    mermaid: z
      .string()
      .min(1)
      .describe(
        "Mermaid source. Supported: flowchart, sequenceDiagram, erDiagram, stateDiagram-v2."
      ),
    fileKey: fileKeyField,
  }),
```

```ts
  generate_diagram: (_nodeIds, params) => ({ ...params }),
```

The tool parses and lays out server-side, then sends the positioned graph:

```ts
server.tool(
  "generate_diagram",
  "Render Mermaid source as a diagram on a FigJam board. Supported diagram types: flowchart, sequenceDiagram, erDiagram, stateDiagram-v2 — anything else is refused rather than approximated. FigJam boards only.",
  toolInputSchemas.generate_diagram.shape,
  async ({ mermaid, fileKey }): Promise<ToolResult> => {
    try {
      const diagram = layoutDiagram(parseMermaid(mermaid));
      return renderResponse(() =>
        node.sendWithParams("render_diagram", undefined, { diagram }, fileKey)
      );
    } catch (err) {
      return {
        content: [textBlock(err instanceof Error ? err.message : String(err))],
        isError: true,
      };
    }
  }
);
```

- [ ] **Step 7: Verify and prove in FigJam**

Run: `cd server && bun run test && bun run build && cd ../plugin && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS — every test green, both builds clean

Then in a FigJam board call `generate_diagram` with the flowchart from step 1's test.

Expected: three connected shapes laid out top-down, labelled, with the viewport framed on them.

- [ ] **Step 8: Prove the refusal**

Call `generate_diagram` with `pie title Votes`.

Expected: an error naming `pie` and listing the four supported types. Nothing is drawn on the board.

- [ ] **Step 9: Commit**

```bash
git add server/src/mermaid/layout.ts server/src/mermaid/layout.test.ts plugin/src/main/code.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat: render Mermaid diagrams into FigJam boards"
```

---

### Task 8: Prove no regression, and document [R50]

The whole phase rests on a manifest change that touches every tool. This is where that gets checked deliberately rather than assumed.

**Files:**

- Create: `plugin/src/main/capabilities.regression.test.ts`
- Modify: `README.md` — tool table, Editing Notes, plugin install section
- Create: `docs/figjam.md`

**Interfaces:**

- Consumes: `CAPABILITIES` from `./capabilities`.
- Produces: documentation and a standing regression test.

- [ ] **Step 1: Write the regression test**

This one asserts a property rather than a list, so it keeps working as tools are added: nothing may be design-only unless it is named here.

_plugin/src/main/capabilities.regression.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { assertEditorSupports, CAPABILITIES } from "./capabilities";

/** Tools that are legitimately design-only. Adding to this list is a decision. */
const DESIGN_ONLY_BY_DESIGN = new Set([
  "set_text_properties",
  "set_gradient_fill",
  "set_effects",
  "set_stroke_properties",
  "set_auto_layout",
  "create_page",
  "create_frame",
  "create_shape",
  "create_image",
  "import_html_layers",
  "import_library_asset",
  "apply_animation_style",
  "remove_animation_style",
  "apply_manual_keyframe_track",
  "remove_manual_keyframe_track",
  "set_timeline_duration",
]);

describe("capability regression", () => {
  test("no tool became design-only without being listed", () => {
    for (const [tool, capability] of Object.entries(CAPABILITIES)) {
      if (capability.editors.length === 1 && capability.editors[0] === "figma") {
        expect(DESIGN_ONLY_BY_DESIGN.has(tool), `${tool} is design-only but not listed`).toBe(true);
      }
    }
  });

  test("no tool is allowed in Dev Mode by accident", () => {
    for (const [tool, capability] of Object.entries(CAPABILITIES)) {
      expect(capability.editors.includes("dev"), `${tool} allows writes in Dev Mode`).toBe(false);
    }
  });

  test("every FigJam-only tool refuses the design editor with a FigJam message", () => {
    for (const [tool, capability] of Object.entries(CAPABILITIES)) {
      if (capability.editors.length === 1 && capability.editors[0] === "figjam") {
        expect(() => assertEditorSupports(tool, "figma")).toThrow(/FigJam/);
      }
    }
  });
});
```

- [ ] **Step 2: Run the whole suite**

Run: `cd plugin && bun run test && cd ../server && bun run test`
Expected: PASS — both suites green, including the new regression file

- [ ] **Step 3: Verify design files by hand one last time**

In a design file, run through: `get_document`, `get_design_context`, `create_frame`, `set_auto_layout`, `set_solid_fill`, `create_text`, `duplicate_nodes`, `delete_nodes`.

Expected: every one behaves exactly as before phase 6. This is the acceptance test for the whole phase.

- [ ] **Step 4: Write the FigJam guide**

Create `docs/figjam.md` covering: which editors the plugin now supports and how to tell which one you are in (`get_metadata` reports `editorType`); what a serialized FigJam board looks like, especially connector endpoints and why topology matters; the four write tools and their FigJam-only restriction; `generate_diagram`'s supported subset with one worked example per diagram type; and what happens with unsupported Mermaid — refused by name, nothing drawn.

- [ ] **Step 5: Update the README**

Add five rows to the tool table:

```markdown
| `create_sticky` | Create a FigJam sticky note ([guide](docs/figjam.md)) |
| `create_shape_with_text` | Create a FigJam shape with text inside it |
| `create_connector` | Connect two FigJam nodes, optionally with a label |
| `create_section` | Create a section in a FigJam board or design file |
| `generate_diagram` | Render Mermaid source as a FigJam diagram — flowchart, sequence, ER, state |
```

Update the plugin install section to say the plugin now runs in design files, FigJam boards, Slides and Dev Mode, and append to Editing Notes:

```markdown
- Tools are gated by editor, not just by Dev Mode: `create_page` and the design write tools need a design file, sticky notes and connectors need FigJam, and Slides support is limited to reads plus text edits inside existing slides ([scope](docs/slides.md)). A tool used in the wrong editor is refused up front with a message naming the editor it needs.
- `generate_diagram` supports flowchart, sequenceDiagram, erDiagram and stateDiagram-v2. Anything else is refused by name — the bridge will not draw an approximation of a diagram type it does not understand.
```

- [ ] **Step 6: Format and run everything**

```bash
bun run format
cd server && bun run test && bun run build
cd ../plugin && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

Expected: PASS — Prettier reports no remaining changes on a second run, both suites green, both builds clean

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/capabilities.regression.test.ts README.md docs/figjam.md
git commit -m "docs: document FigJam, Slides and diagram support"
```

---

## Done when

- `bun test` is green in both packages, including the capability regression file.
- `bun run build` succeeds in both packages and the plugin type-checks.
- Every existing design tool behaves in a design file exactly as it did before this phase — checked by the regression test and by hand.
- The plugin connects in FigJam, Slides and Dev Mode, and `get_metadata` reports the editor.
- A FigJam board serializes with connector endpoints intact, so its topology survives.
- `create_sticky`, `create_shape_with_text`, `create_connector` and `create_section` work in FigJam and are refused elsewhere with a message naming the editor they need.
- `generate_diagram` renders all four supported Mermaid types and refuses a fifth by name without drawing anything.
- `docs/figjam.md` and `docs/slides.md` state what is supported and what is deliberately not.
