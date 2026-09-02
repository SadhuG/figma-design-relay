# Serializer Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the node serializer to carry the design-system identity an agent needs to write correct code — component and instance identity, resolved variable and style names, layout intent, prototyping and Dev Mode annotations — instead of geometry alone.

**Architecture:** Three new dependency-free plugin modules do the resolution work behind injected async lookups, so each unit-tests without a Figma runtime. `serializer.ts` then becomes asynchronous and composes them, and `code.ts` awaits it at four call sites. Every new field is omitted when absent, so an unremarkable rectangle serializes exactly as it does today.

**Tech Stack:** TypeScript, Bun (`bun test`), Vite, `@figma/plugin-typings`, and the Figma Plugin API under `documentAccess: "dynamic-page"`.

**Spec:** `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md` — this plan implements that spec's **Phase 2** and its requirements R11–R19.

## Global Constraints

- Node `>=20.0.0`; Bun is the package manager and script runner throughout — never `npm`/`yarn`.
- Plugin sources use extensionless relative imports (e.g. `./serializer`). Server sources under `server/src` need the `.js` extension; this plan does not touch them.
- Prettier 3.9.6 formats everything; a Husky `pre-commit` hook runs `lint-staged`. Run `bun run format` from the repo root if a commit reformats your file.
- **Phase 1's test harness must already be in place.** This plan writes `bun test` files in `plugin/`, so `plugin/package.json` needs its `test` script and `plugin/tsconfig.json` needs test files excluded. If `cd plugin && bun run test` errors with a missing script, stop and finish phase 1 task 1 first.
- `plugin/manifest.json` declares `"documentAccess": "dynamic-page"`. The synchronous accessors this phase would otherwise use are unavailable: read component identity through `instance.getMainComponentAsync()`, styles through `figma.getStyleByIdAsync()`, variables through `figma.variables.getVariableByIdAsync()`, and collections through `figma.variables.getVariableCollectionByIdAsync()`.
- **New modules must never reference the `figma` global.** They take their lookups as parameters. That is what lets them run under Bun, and it is not negotiable — a module that reaches for `figma` cannot be tested.
- **Every field this plan adds is omitted when absent, empty, or at its default.** Enrichment must not make `get_document` unusable on a large page.
- Never reformat or restructure code outside the files each task lists.

---

### Task 1: Design-system reference resolution [R14, R15]

A node points at design-system objects by id — a fill bound to a variable, a paint set from a named style. Those ids are useless to an agent on their own; `color/brand/primary` is what it needs to see. This module turns ids into names, behind injected lookups so it tests without Figma.

**Files:**

- Create: `plugin/src/main/references.ts`
- Create: `plugin/src/main/references.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `resolveBoundVariables(boundVariables, lookupVariable, lookupCollection): Promise<VariableRef[] | undefined>` and `resolveStyleRef(styleId, lookupStyle): Promise<StyleRef | "mixed" | undefined>`, plus the `VariableRef`, `StyleRef`, `VariableLookup`, `CollectionLookup` and `StyleLookup` types. Task 4 imports all of them from `./references`.

- [ ] **Step 1: Write the failing test**

_plugin/src/main/references.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { resolveBoundVariables, resolveStyleRef } from "./references";

const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });

const lookupVariable = async (id: string) =>
  id === "VariableID:1:2"
    ? { name: "color/brand/primary", variableCollectionId: "VariableCollectionId:1:1" }
    : null;

const lookupCollection = async (id: string) =>
  id === "VariableCollectionId:1:1" ? { name: "Brand" } : null;

const lookupStyle = async (id: string) => (id === "S:abc" ? { name: "Body/Regular" } : null);

describe("resolveBoundVariables", () => {
  test("returns undefined when there is nothing bound", async () => {
    expect(
      await resolveBoundVariables(undefined, lookupVariable, lookupCollection)
    ).toBeUndefined();
    expect(await resolveBoundVariables({}, lookupVariable, lookupCollection)).toBeUndefined();
  });

  test("resolves a scalar binding to its variable and collection name", async () => {
    const out = await resolveBoundVariables(
      { cornerRadius: alias("VariableID:1:2") },
      lookupVariable,
      lookupCollection
    );
    expect(out).toEqual([
      {
        property: "cornerRadius",
        variableId: "VariableID:1:2",
        variableName: "color/brand/primary",
        collectionName: "Brand",
      },
    ]);
  });

  test("indexes array bindings by position", async () => {
    const out = await resolveBoundVariables(
      { fills: [alias("VariableID:1:2")] },
      lookupVariable,
      lookupCollection
    );
    expect(out?.[0].property).toBe("fills[0]");
  });

  test("keeps the id when the variable cannot be found", async () => {
    const out = await resolveBoundVariables(
      { opacity: alias("VariableID:9:9") },
      lookupVariable,
      lookupCollection
    );
    expect(out).toEqual([{ property: "opacity", variableId: "VariableID:9:9" }]);
  });

  test("ignores entries that are not variable aliases", async () => {
    const out = await resolveBoundVariables(
      { fills: ["not an alias"], name: null },
      lookupVariable,
      lookupCollection
    );
    expect(out).toBeUndefined();
  });
});

describe("resolveStyleRef", () => {
  test('renders a mixed style id as "mixed"', async () => {
    expect(await resolveStyleRef(Symbol("figma.mixed"), lookupStyle)).toBe("mixed");
  });

  test("returns undefined for an unset style", async () => {
    expect(await resolveStyleRef("", lookupStyle)).toBeUndefined();
    expect(await resolveStyleRef(undefined, lookupStyle)).toBeUndefined();
  });

  test("resolves a known style to its name", async () => {
    expect(await resolveStyleRef("S:abc", lookupStyle)).toEqual({
      id: "S:abc",
      name: "Body/Regular",
    });
  });

  test("keeps the id when the style cannot be found", async () => {
    expect(await resolveStyleRef("S:gone", lookupStyle)).toEqual({ id: "S:gone" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/references.test.ts`
Expected: FAIL — `Cannot find module './references'`

- [ ] **Step 3: Write the implementation**

_plugin/src/main/references.ts — create_

```ts
/**
 * Resolves the design-system references a node points at — bound variables and
 * named styles — into shapes an agent can act on.
 *
 * Under `documentAccess: "dynamic-page"` the Plugin API only exposes async
 * lookups, so every resolver takes its lookup as a parameter. That also keeps
 * this module free of the `figma` global, so it unit-tests under Bun.
 */

export interface VariableRef {
  property: string;
  variableId: string;
  variableName?: string;
  collectionName?: string;
}

export interface StyleRef {
  id: string;
  name?: string;
}

export type VariableLookup = (
  id: string
) => Promise<{ name: string; variableCollectionId: string } | null>;

export type CollectionLookup = (id: string) => Promise<{ name: string } | null>;

export type StyleLookup = (id: string) => Promise<{ name: string } | null>;

interface VariableAlias {
  type: "VARIABLE_ALIAS";
  id: string;
}

const isAlias = (value: unknown): value is VariableAlias =>
  typeof value === "object" &&
  value !== null &&
  (value as VariableAlias).type === "VARIABLE_ALIAS" &&
  typeof (value as VariableAlias).id === "string";

/**
 * Flattens `{ fills: [alias, alias], cornerRadius: alias }` into one list,
 * naming array entries by position so `fills[0]` is addressable.
 */
const flattenAliases = (
  boundVariables: Record<string, unknown>
): Array<{ property: string; id: string }> => {
  const out: Array<{ property: string; id: string }> = [];
  for (const [field, value] of Object.entries(boundVariables)) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (isAlias(entry)) out.push({ property: `${field}[${index}]`, id: entry.id });
      });
    } else if (isAlias(value)) {
      out.push({ property: field, id: value.id });
    }
  }
  return out;
};

/**
 * Resolves a node's `boundVariables` map into named references.
 * @param boundVariables - The raw map off the node, or undefined.
 * @param lookupVariable - Async variable lookup by id.
 * @param lookupCollection - Async collection lookup by id.
 * @returns One entry per binding, or undefined when nothing is bound.
 */
export const resolveBoundVariables = async (
  boundVariables: Record<string, unknown> | undefined,
  lookupVariable: VariableLookup,
  lookupCollection: CollectionLookup
): Promise<VariableRef[] | undefined> => {
  if (!boundVariables) return undefined;

  const aliases = flattenAliases(boundVariables);
  if (aliases.length === 0) return undefined;

  return Promise.all(
    aliases.map(async ({ property, id }): Promise<VariableRef> => {
      const variable = await lookupVariable(id);
      if (!variable) return { property, variableId: id };
      const collection = await lookupCollection(variable.variableCollectionId);
      const ref: VariableRef = { property, variableId: id, variableName: variable.name };
      if (collection) ref.collectionName = collection.name;
      return ref;
    })
  );
};

/**
 * Resolves one `*StyleId` property to its style name.
 * @param styleId - The raw property value; `figma.mixed` is a symbol.
 * @param lookupStyle - Async style lookup by id.
 * @returns The named reference, the string "mixed", or undefined when unset.
 */
export const resolveStyleRef = async (
  styleId: unknown,
  lookupStyle: StyleLookup
): Promise<StyleRef | "mixed" | undefined> => {
  if (typeof styleId === "symbol") return "mixed";
  if (typeof styleId !== "string" || styleId === "") return undefined;
  const style = await lookupStyle(styleId);
  return style ? { id: styleId, name: style.name } : { id: styleId };
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/references.test.ts`
Expected: PASS — 9 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/references.ts plugin/src/main/references.test.ts
git commit -m "feat(plugin): resolve bound variables and style ids to names"
```

---

### Task 2: Component and instance identity [R12, R13]

Without this an instance of `Button/Primary` serializes as an anonymous frame. The subtlety is `componentPropertyDefinitions`: it is readable only from the node that owns the definitions, and reading it off a variant `COMPONENT` throws. Optional chaining does not make that safe, so narrow the owner first.

**Files:**

- Create: `plugin/src/main/component-identity.ts`
- Create: `plugin/src/main/component-identity.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `componentPropertyOwner(node): NodeLike | null`, `serializeInstanceIdentity(instance): Promise<InstanceIdentity | undefined>` and `serializeComponentIdentity(node): ComponentIdentity | undefined`, plus the `NodeLike`, `InstanceLike`, `InstanceIdentity` and `ComponentIdentity` types. Task 4 imports them from `./component-identity`.

- [ ] **Step 1: Write the failing test**

_plugin/src/main/component-identity.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import {
  componentPropertyOwner,
  serializeComponentIdentity,
  serializeInstanceIdentity,
} from "./component-identity";

const set = {
  id: "1:1",
  type: "COMPONENT_SET",
  name: "Button",
  key: "setkey",
  componentPropertyDefinitions: { Size: { type: "VARIANT", defaultValue: "M" } },
};

const variant = {
  id: "1:2",
  type: "COMPONENT",
  name: "Size=M",
  key: "variantkey",
  parent: set,
};

const standalone = {
  id: "2:1",
  type: "COMPONENT",
  name: "Divider",
  key: "dividerkey",
  parent: { id: "0:1", type: "FRAME" },
  componentPropertyDefinitions: {},
};

describe("componentPropertyOwner", () => {
  test("a component set owns its own definitions", () => {
    expect(componentPropertyOwner(set)?.id).toBe("1:1");
  });

  test("a variant promotes to its parent set", () => {
    expect(componentPropertyOwner(variant)?.id).toBe("1:1");
  });

  test("a standalone component owns its own definitions", () => {
    expect(componentPropertyOwner(standalone)?.id).toBe("2:1");
  });

  test("a non-component has no owner", () => {
    expect(componentPropertyOwner({ id: "3:1", type: "FRAME" })).toBeNull();
  });
});

describe("serializeComponentIdentity", () => {
  test("emits the key and the definitions for a set", () => {
    expect(serializeComponentIdentity(set)).toEqual({
      key: "setkey",
      propertyDefinitions: { Size: { type: "VARIANT", defaultValue: "M" } },
    });
  });

  test("names the owner when a variant borrows its parent's definitions", () => {
    expect(serializeComponentIdentity(variant)).toEqual({
      key: "variantkey",
      propertyDefinitions: { Size: { type: "VARIANT", defaultValue: "M" } },
      propertyOwnerId: "1:1",
    });
  });

  test("omits empty definitions", () => {
    expect(serializeComponentIdentity(standalone)).toEqual({ key: "dividerkey" });
  });

  test("returns undefined for a non-component", () => {
    expect(serializeComponentIdentity({ id: "3:1", type: "FRAME" })).toBeUndefined();
  });
});

describe("serializeInstanceIdentity", () => {
  test("resolves the main component asynchronously", async () => {
    const out = await serializeInstanceIdentity({
      getMainComponentAsync: async () => ({ id: "1:2", key: "variantkey", name: "Size=M" }),
      componentProperties: { Label: { type: "TEXT", value: "Save" } },
    });
    expect(out).toEqual({
      mainComponent: { id: "1:2", key: "variantkey", name: "Size=M" },
      componentProperties: { Label: { type: "TEXT", value: "Save" } },
    });
  });

  test("returns undefined for a detached instance with no properties", async () => {
    const out = await serializeInstanceIdentity({ getMainComponentAsync: async () => null });
    expect(out).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/component-identity.test.ts`
Expected: FAIL — `Cannot find module './component-identity'`

- [ ] **Step 3: Write the implementation**

_plugin/src/main/component-identity.ts — create_

```ts
/**
 * Component and instance identity.
 *
 * `componentPropertyDefinitions` is readable only from the node that owns the
 * definitions. Reading it from a variant `COMPONENT` — one whose parent is a
 * `COMPONENT_SET` — throws, and optional chaining does not make the getter
 * safe. So narrow the owner first, always.
 */

export interface NodeLike {
  id: string;
  type: string;
  name?: string;
  key?: string;
  parent?: NodeLike | null;
  componentPropertyDefinitions?: Record<string, unknown>;
}

export interface ComponentRef {
  id: string;
  key?: string;
  name?: string;
}

export interface ComponentIdentity {
  key?: string;
  propertyDefinitions?: Record<string, unknown>;
  /** Set only when the definitions came from a parent set rather than the node. */
  propertyOwnerId?: string;
}

export interface InstanceLike {
  getMainComponentAsync: () => Promise<ComponentRef | null>;
  componentProperties?: Record<string, { type: string; value: unknown }>;
}

export interface InstanceIdentity {
  mainComponent?: ComponentRef;
  componentProperties?: Record<string, { type: string; value: unknown }>;
}

/**
 * Returns the node that owns `componentPropertyDefinitions`.
 * @param node - Any scene node.
 * @returns The owning node, or null when the node is not a component at all.
 */
export const componentPropertyOwner = (node: NodeLike): NodeLike | null => {
  if (node.type === "COMPONENT_SET") return node;
  if (node.type !== "COMPONENT") return null;
  return node.parent && node.parent.type === "COMPONENT_SET" ? node.parent : node;
};

/**
 * Serializes a `COMPONENT` or `COMPONENT_SET`'s published identity.
 * @param node - The component or component set.
 * @returns Its key and property definitions, or undefined when it has neither.
 */
export const serializeComponentIdentity = (node: NodeLike): ComponentIdentity | undefined => {
  const owner = componentPropertyOwner(node);
  if (!owner) return undefined;

  const identity: ComponentIdentity = {};
  if (node.key) identity.key = node.key;

  const definitions = owner.componentPropertyDefinitions;
  if (definitions && Object.keys(definitions).length > 0) {
    identity.propertyDefinitions = definitions;
    if (owner.id !== node.id) identity.propertyOwnerId = owner.id;
  }

  return Object.keys(identity).length > 0 ? identity : undefined;
};

/**
 * Serializes an `INSTANCE`'s link back to its main component.
 * @param instance - The instance node.
 * @returns Its main component and set properties, or undefined when it has neither.
 */
export const serializeInstanceIdentity = async (
  instance: InstanceLike
): Promise<InstanceIdentity | undefined> => {
  const main = await instance.getMainComponentAsync();
  const properties = instance.componentProperties;
  const hasProperties = properties !== undefined && Object.keys(properties).length > 0;
  if (!main && !hasProperties) return undefined;

  const identity: InstanceIdentity = {};
  if (main) identity.mainComponent = { id: main.id, key: main.key, name: main.name };
  if (hasProperties) identity.componentProperties = properties;
  return identity;
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/component-identity.test.ts`
Expected: PASS — 10 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/component-identity.ts plugin/src/main/component-identity.test.ts
git commit -m "feat(plugin): serialize component and instance identity"
```

---

### Task 3: Layout intent, prototyping and annotations [R16, R17, R18]

Geometry says what a node currently measures. Intent says what it is for — hug, fill, grow, the prototype it triggers, the note a designer pinned to it. Every helper here returns `undefined` when there is nothing worth saying, which is how R19's discipline is enforced at the source rather than filtered afterwards.

**Files:**

- Create: `plugin/src/main/intent.ts`
- Create: `plugin/src/main/intent.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `serializeLayoutIntent(node)`, `serializeReactions(node)`, `serializeAnnotations(node)`, `serializeExportSettings(node)` and `serializeRenderBounds(node)`, each taking a `Record<string, unknown>` and returning its shape or `undefined`. Task 4 imports all five from `./intent`.

- [ ] **Step 1: Write the failing test**

_plugin/src/main/intent.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import {
  serializeAnnotations,
  serializeExportSettings,
  serializeLayoutIntent,
  serializeReactions,
  serializeRenderBounds,
} from "./intent";

describe("serializeLayoutIntent", () => {
  test("returns undefined for a node with no layout intent", () => {
    expect(serializeLayoutIntent({ layoutGrow: 0, layoutAlign: "INHERIT" })).toBeUndefined();
  });

  test("emits hug and fill sizing", () => {
    expect(
      serializeLayoutIntent({ layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" })
    ).toEqual({ sizingHorizontal: "FILL", sizingVertical: "HUG" });
  });

  test("omits defaults but keeps non-defaults", () => {
    expect(
      serializeLayoutIntent({
        layoutGrow: 1,
        layoutAlign: "INHERIT",
        layoutPositioning: "ABSOLUTE",
        itemReverseZIndex: false,
      })
    ).toEqual({ grow: 1, positioning: "ABSOLUTE" });
  });

  test("carries min and max constraints", () => {
    expect(serializeLayoutIntent({ minWidth: 120, maxHeight: 400 })).toEqual({
      minWidth: 120,
      maxHeight: 400,
    });
  });
});

describe("serializeReactions", () => {
  test("returns undefined when there are none", () => {
    expect(serializeReactions({ reactions: [] })).toBeUndefined();
    expect(serializeReactions({})).toBeUndefined();
  });

  test("summarises a navigate reaction", () => {
    const out = serializeReactions({
      reactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [{ type: "NODE", destinationId: "4:5", navigation: "NAVIGATE" }],
        },
      ],
    });
    expect(out).toEqual([
      {
        trigger: "ON_CLICK",
        actions: [{ type: "NODE", destinationId: "4:5", navigation: "NAVIGATE" }],
      },
    ]);
  });
});

describe("serializeAnnotations", () => {
  test("returns undefined when there are none", () => {
    expect(serializeAnnotations({ annotations: [] })).toBeUndefined();
  });

  test("keeps the label and the pinned property types", () => {
    const out = serializeAnnotations({
      annotations: [{ label: "Uses the brand token", properties: [{ type: "fills" }] }],
    });
    expect(out).toEqual([{ label: "Uses the brand token", properties: ["fills"] }]);
  });
});

describe("serializeExportSettings", () => {
  test("returns undefined when the node is not exportable", () => {
    expect(serializeExportSettings({ exportSettings: [] })).toBeUndefined();
  });

  test("summarises a scaled PNG export", () => {
    const out = serializeExportSettings({
      exportSettings: [{ format: "PNG", suffix: "@2x", constraint: { type: "SCALE", value: 2 } }],
    });
    expect(out).toEqual([
      { format: "PNG", suffix: "@2x", constraint: { type: "SCALE", value: 2 } },
    ]);
  });
});

describe("serializeRenderBounds", () => {
  test("omits render bounds that match the bounding box", () => {
    const box = { x: 0, y: 0, width: 100, height: 50 };
    expect(
      serializeRenderBounds({ absoluteBoundingBox: box, absoluteRenderBounds: { ...box } })
    ).toBeUndefined();
  });

  test("emits render bounds when a shadow makes them differ", () => {
    expect(
      serializeRenderBounds({
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
        absoluteRenderBounds: { x: -4, y: -4, width: 108, height: 58 },
      })
    ).toEqual({ x: -4, y: -4, width: 108, height: 58 });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/intent.test.ts`
Expected: FAIL — `Cannot find module './intent'`

- [ ] **Step 3: Write the implementation**

_plugin/src/main/intent.ts — create_

```ts
/**
 * Layout intent, prototyping and annotations — the parts of a node that say
 * what it is *for*, not what it currently measures.
 *
 * Every helper returns `undefined` when the node carries nothing worth saying,
 * so an unremarkable rectangle serializes exactly as it did before phase 2.
 */

export interface LayoutIntent {
  sizingHorizontal?: string;
  sizingVertical?: string;
  grow?: number;
  align?: string;
  positioning?: string;
  reverseZIndex?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReactionSummary {
  trigger?: string;
  actions: Array<{ type: string; destinationId?: string; navigation?: string }>;
}

export interface AnnotationSummary {
  label?: string;
  properties?: string[];
}

export interface ExportSummary {
  format?: string;
  suffix?: string;
  constraint?: { type: string; value?: number };
}

type Raw = Record<string, unknown>;

const LAYOUT_DEFAULTS = {
  layoutGrow: 0,
  layoutAlign: "INHERIT",
  layoutPositioning: "AUTO",
} as const;

const MEASURES = ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const;

/**
 * Extracts hug/fill/grow intent and the min-max constraints.
 * @param node - The raw scene node.
 * @returns The intent, or undefined when the node is at every default.
 */
export const serializeLayoutIntent = (node: Raw): LayoutIntent | undefined => {
  const intent: LayoutIntent = {};

  if (typeof node.layoutSizingHorizontal === "string") {
    intent.sizingHorizontal = node.layoutSizingHorizontal;
  }
  if (typeof node.layoutSizingVertical === "string") {
    intent.sizingVertical = node.layoutSizingVertical;
  }
  if (typeof node.layoutGrow === "number" && node.layoutGrow !== LAYOUT_DEFAULTS.layoutGrow) {
    intent.grow = node.layoutGrow;
  }
  if (typeof node.layoutAlign === "string" && node.layoutAlign !== LAYOUT_DEFAULTS.layoutAlign) {
    intent.align = node.layoutAlign;
  }
  if (
    typeof node.layoutPositioning === "string" &&
    node.layoutPositioning !== LAYOUT_DEFAULTS.layoutPositioning
  ) {
    intent.positioning = node.layoutPositioning;
  }
  if (node.itemReverseZIndex === true) intent.reverseZIndex = true;

  for (const key of MEASURES) {
    const value = node[key];
    if (typeof value === "number") intent[key] = value;
  }

  return Object.keys(intent).length > 0 ? intent : undefined;
};

/**
 * Summarises prototyping reactions down to trigger and destination.
 * @param node - The raw scene node.
 * @returns One summary per reaction, or undefined when there are none.
 */
export const serializeReactions = (node: Raw): ReactionSummary[] | undefined => {
  const reactions = node.reactions;
  if (!Array.isArray(reactions) || reactions.length === 0) return undefined;

  return reactions.map((entry) => {
    const reaction = entry as { trigger?: { type?: string }; actions?: unknown[] };
    const actions = Array.isArray(reaction.actions) ? reaction.actions : [];
    const summary: ReactionSummary = {
      actions: actions.map((raw) => {
        const action = raw as { type?: string; destinationId?: string; navigation?: string };
        const out: ReactionSummary["actions"][number] = { type: action.type ?? "UNKNOWN" };
        if (action.destinationId) out.destinationId = action.destinationId;
        if (action.navigation) out.navigation = action.navigation;
        return out;
      }),
    };
    if (reaction.trigger?.type) summary.trigger = reaction.trigger.type;
    return summary;
  });
};

/**
 * Keeps a designer's Dev Mode notes and the property types they pinned.
 * @param node - The raw scene node.
 * @returns One summary per annotation, or undefined when there are none.
 */
export const serializeAnnotations = (node: Raw): AnnotationSummary[] | undefined => {
  const annotations = node.annotations;
  if (!Array.isArray(annotations) || annotations.length === 0) return undefined;

  return annotations.map((entry) => {
    const annotation = entry as { label?: string; properties?: Array<{ type?: string }> };
    const summary: AnnotationSummary = {};
    if (annotation.label) summary.label = annotation.label;
    const properties = Array.isArray(annotation.properties)
      ? annotation.properties
          .map((property) => property.type)
          .filter((type): type is string => typeof type === "string")
      : [];
    if (properties.length > 0) summary.properties = properties;
    return summary;
  });
};

/**
 * Reports how the designer intends this node to be exported.
 * @param node - The raw scene node.
 * @returns One summary per export setting, or undefined when there are none.
 */
export const serializeExportSettings = (node: Raw): ExportSummary[] | undefined => {
  const settings = node.exportSettings;
  if (!Array.isArray(settings) || settings.length === 0) return undefined;

  return settings.map((entry) => {
    const setting = entry as {
      format?: string;
      suffix?: string;
      constraint?: { type?: string; value?: number };
    };
    const summary: ExportSummary = {};
    if (setting.format) summary.format = setting.format;
    if (setting.suffix) summary.suffix = setting.suffix;
    if (setting.constraint?.type) {
      summary.constraint = { type: setting.constraint.type, value: setting.constraint.value };
    }
    return summary;
  });
};

/**
 * Emits render bounds only when effects or overflow push them past the
 * bounding box — otherwise the two boxes are identical and one is noise.
 * @param node - The raw scene node.
 * @returns The render bounds, or undefined when they match the bounding box.
 */
export const serializeRenderBounds = (node: Raw): Box | undefined => {
  const render = node.absoluteRenderBounds as Box | null | undefined;
  if (!render) return undefined;
  const box = node.absoluteBoundingBox as Box | null | undefined;
  if (
    box &&
    box.x === render.x &&
    box.y === render.y &&
    box.width === render.width &&
    box.height === render.height
  ) {
    return undefined;
  }
  return { x: render.x, y: render.y, width: render.width, height: render.height };
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/intent.test.ts`
Expected: PASS — 11 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/intent.ts plugin/src/main/intent.test.ts
git commit -m "feat(plugin): serialize layout intent, reactions and annotations"
```

---

### Task 4: Make the serializer async and compose the new modules [R11, R19]

`serializeNode` is synchronous today. The lookups from tasks 1 and 2 are not, and cannot be — `documentAccess: "dynamic-page"` only exposes async accessors. So the function becomes `async`, and this is the task where R19's discipline gets its regression test: a plain rectangle must come out exactly as it does today.

Note the ordering constraint that makes that test possible: the resolvers short-circuit before touching their lookups when a node carries no reference, so a plain rectangle never reaches the `figma` global at all.

**Files:**

- Modify: `plugin/src/main/serializer.ts` — imports, the `SerializedNode` interface, and `serializeNode` (currently lines 347-372)
- Create: `plugin/src/main/serializer.test.ts`

**Interfaces:**

- Consumes: `resolveBoundVariables`, `resolveStyleRef` from `./references`; `serializeComponentIdentity`, `serializeInstanceIdentity` from `./component-identity`; `serializeLayoutIntent`, `serializeReactions`, `serializeAnnotations`, `serializeExportSettings`, `serializeRenderBounds` from `./intent`.
- Produces: `serializeNode(node: SceneNode): Promise<SerializedNode>` — the same name, now returning a promise, with optional `design`, `layout`, `reactions`, `annotations`, `exportSettings` and `renderBounds` fields. Task 5 awaits it at every call site.

- [ ] **Step 1: Write the baseline regression test first**

This is the test that stops enrichment from bloating every payload. Write it before touching the serializer.

_plugin/src/main/serializer.test.ts — create_

```ts
import { beforeAll, describe, expect, test } from "bun:test";

/**
 * Minimal `figma` global. The serializer must not reach it for a node that
 * carries no design-system reference; these stubs throw if it does.
 */
beforeAll(() => {
  (globalThis as Record<string, unknown>).figma = {
    getStyleByIdAsync: async (id: string) => (id === "S:abc" ? { name: "Body/Regular" } : null),
    variables: {
      getVariableByIdAsync: async (id: string) =>
        id === "VariableID:1:2"
          ? { name: "color/brand/primary", variableCollectionId: "VariableCollectionId:1:1" }
          : null,
      getVariableCollectionByIdAsync: async () => ({ name: "Brand" }),
    },
  };
});

const { serializeNode } = await import("./serializer");

const rectangle = {
  id: "1:5",
  name: "Divider",
  type: "RECTANGLE",
  visible: true,
  opacity: 1,
  blendMode: "PASS_THROUGH",
  fills: [],
  strokes: [],
  effects: [],
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 1 },
} as unknown as SceneNode;

describe("serializeNode", () => {
  test("a plain rectangle gains no new keys", async () => {
    const out = await serializeNode(rectangle);
    expect(Object.keys(out).sort()).toEqual(["bounds", "id", "name", "styles", "type"]);
  });

  test("an instance carries its main component", async () => {
    const out = await serializeNode({
      ...rectangle,
      id: "1:6",
      type: "INSTANCE",
      getMainComponentAsync: async () => ({ id: "9:1", key: "btnkey", name: "Button/Primary" }),
      componentProperties: { Label: { type: "TEXT", value: "Save" } },
    } as unknown as SceneNode);
    expect(out.design?.mainComponent).toEqual({
      id: "9:1",
      key: "btnkey",
      name: "Button/Primary",
    });
  });

  test("a bound fill resolves to its token name", async () => {
    const out = await serializeNode({
      ...rectangle,
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:1:2" }] },
    } as unknown as SceneNode);
    expect(out.design?.boundVariables?.[0]).toMatchObject({
      property: "fills[0]",
      variableName: "color/brand/primary",
      collectionName: "Brand",
    });
  });

  test("a named text style resolves to its style name", async () => {
    const out = await serializeNode({
      ...rectangle,
      fillStyleId: "S:abc",
    } as unknown as SceneNode);
    expect(out.design?.styles?.fill).toEqual({ id: "S:abc", name: "Body/Regular" });
  });

  test("layout intent rides along when it is not at defaults", async () => {
    const out = await serializeNode({
      ...rectangle,
      layoutSizingHorizontal: "FILL",
    } as unknown as SceneNode);
    expect(out.layout).toEqual({ sizingHorizontal: "FILL" });
  });

  test("children are serialized concurrently and in order", async () => {
    const out = await serializeNode({
      ...rectangle,
      id: "1:7",
      type: "FRAME",
      children: [
        { ...rectangle, id: "1:8", name: "A" },
        { ...rectangle, id: "1:9", name: "B", visible: false },
        { ...rectangle, id: "1:10", name: "C" },
      ],
    } as unknown as SceneNode);
    expect(out.children?.map((child) => child.name)).toEqual(["A", "C"]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/serializer.test.ts`
Expected: FAIL — `serializeNode(...).then is not a function`, because the serializer is still synchronous

- [ ] **Step 3: Extend the SerializedNode interface**

At the top of `plugin/src/main/serializer.ts`, add the imports and widen the exported node shape. Add these fields to the existing `SerializedNode` interface — do not remove anything already there.

```ts
import {
  resolveBoundVariables,
  resolveStyleRef,
  type StyleRef,
  type VariableRef,
} from "./references";
import {
  serializeComponentIdentity,
  serializeInstanceIdentity,
  type ComponentRef,
} from "./component-identity";
import {
  serializeAnnotations,
  serializeExportSettings,
  serializeLayoutIntent,
  serializeReactions,
  serializeRenderBounds,
  type AnnotationSummary,
  type Box,
  type ExportSummary,
  type LayoutIntent,
  type ReactionSummary,
} from "./intent";

export interface SerializedDesign {
  mainComponent?: ComponentRef;
  componentProperties?: Record<string, { type: string; value: unknown }>;
  key?: string;
  propertyDefinitions?: Record<string, unknown>;
  propertyOwnerId?: string;
  boundVariables?: VariableRef[];
  styles?: Record<string, StyleRef | "mixed">;
}
```

Then, inside `SerializedNode`:

```ts
  design?: SerializedDesign;
  layout?: LayoutIntent;
  reactions?: ReactionSummary[];
  annotations?: AnnotationSummary[];
  exportSettings?: ExportSummary[];
  renderBounds?: Box;
```

- [ ] **Step 4: Add the design-system resolver**

Still in `serializer.ts`, above `serializeNode`. The `figma` lookups live here and nowhere else, which is what keeps the three new modules testable.

```ts
const STYLE_FIELDS = {
  fill: "fillStyleId",
  stroke: "strokeStyleId",
  effect: "effectStyleId",
  grid: "gridStyleId",
  text: "textStyleId",
} as const;

const lookupVariable = async (id: string) => {
  const variable = await figma.variables.getVariableByIdAsync(id);
  return variable
    ? { name: variable.name, variableCollectionId: variable.variableCollectionId }
    : null;
};

const lookupCollection = async (id: string) => {
  const collection = await figma.variables.getVariableCollectionByIdAsync(id);
  return collection ? { name: collection.name } : null;
};

const lookupStyle = async (id: string) => {
  const style = await figma.getStyleByIdAsync(id);
  return style ? { name: style.name } : null;
};

/**
 * Collects everything that ties a node to the design system: its component
 * identity, the variables bound to its properties, and the named styles it uses.
 * @param node - The scene node.
 * @returns The design block, or undefined when the node references nothing.
 */
const serializeDesign = async (node: SceneNode): Promise<SerializedDesign | undefined> => {
  const raw = node as unknown as Record<string, unknown>;
  const design: SerializedDesign = {};

  if (node.type === "INSTANCE") {
    const identity = await serializeInstanceIdentity(node as never);
    if (identity) Object.assign(design, identity);
  } else if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    const identity = serializeComponentIdentity(node as never);
    if (identity) Object.assign(design, identity);
  }

  const bound = await resolveBoundVariables(
    raw.boundVariables as Record<string, unknown> | undefined,
    lookupVariable,
    lookupCollection
  );
  if (bound) design.boundVariables = bound;

  const styles: Record<string, StyleRef | "mixed"> = {};
  for (const [name, field] of Object.entries(STYLE_FIELDS)) {
    const ref = await resolveStyleRef(raw[field], lookupStyle);
    if (ref) styles[name] = ref;
  }
  if (Object.keys(styles).length > 0) design.styles = styles;

  return Object.keys(design).length > 0 ? design : undefined;
};
```

- [ ] **Step 5: Make serializeNode async**

Replace the existing `serializeNode` export at the bottom of `serializer.ts`. Children are awaited with `Promise.all` so a wide frame does not serialize one child at a time.

```ts
export const serializeNode = async (node: SceneNode): Promise<SerializedNode> => {
  const raw = node as unknown as Record<string, unknown>;
  const base: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: getBounds(node),
    styles: serializeStyles(node),
  };

  const design = await serializeDesign(node);
  if (design) base.design = design;

  const layout = serializeLayoutIntent(raw);
  if (layout) base.layout = layout;

  const reactions = serializeReactions(raw);
  if (reactions) base.reactions = reactions;

  const annotations = serializeAnnotations(raw);
  if (annotations) base.annotations = annotations;

  const exportSettings = serializeExportSettings(raw);
  if (exportSettings) base.exportSettings = exportSettings;

  const renderBounds = serializeRenderBounds(raw);
  if (renderBounds) base.renderBounds = renderBounds;

  if (node.type === "TEXT") {
    return serializeText(node, base);
  }

  if ("children" in node) {
    const visible = node.children.filter((child) => child.visible !== false);
    return {
      ...base,
      children: await Promise.all(visible.map((child) => serializeNode(child))),
    };
  }

  return base;
};
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/serializer.test.ts`
Expected: PASS — 6 pass, 0 fail. If the first test fails with extra keys, a helper is returning an empty object instead of `undefined`; fix the helper rather than filtering here.

- [ ] **Step 7: Run the whole plugin suite**

Run: `cd plugin && bun run test`
Expected: PASS — 36 pass, 0 fail (9 references, 10 component identity, 11 intent, 6 serializer, plus phase 1's 19 if that plan has landed)

- [ ] **Step 8: Commit**

```bash
git add plugin/src/main/serializer.ts plugin/src/main/serializer.test.ts
git commit -m "feat(plugin): serialize design-system identity and layout intent"
```

---

### Task 5: Await the serializer at every call site [R11]

`serializeNode` now returns a promise. `plugin/src/main/code.ts` calls it in four places, and TypeScript will point at each one. This task is mechanical, but `get_selection` and `get_node` need `Promise.all` rather than a bare `map`, which is the kind of thing that silently ships an array of promises.

**Files:**

- Modify: `plugin/src/main/code.ts` — the `get_document`, `get_selection`, `get_node` and `get_design_context` cases (currently lines 375-512)

**Interfaces:**

- Consumes: `serializeNode(node): Promise<SerializedNode>` from task 4.
- Produces: no new exports. Every read tool returns the enriched shape.

- [ ] **Step 1: Find every call site**

Run: `cd plugin && bunx tsc --noEmit -p tsconfig.json`
Expected: FAIL — four errors of the form `Type 'Promise<SerializedNode>' is not assignable to type 'SerializedNode'`, one per call site. Use them as the worklist.

- [ ] **Step 2: Await in get_document**

```ts
      case "get_document":
        return {
          type: request.type,
          requestId: request.requestId,
          data: await serializeNode(figma.currentPage as unknown as SceneNode),
        };
```

- [ ] **Step 3: Await in get_selection**

A bare `.map(serializeNode)` here would return an array of promises and serialize as `[{},{}]`. Use `Promise.all`.

```ts
      case "get_selection":
        return {
          type: request.type,
          requestId: request.requestId,
          data: await Promise.all(
            figma.currentPage.selection.map((node) => serializeNode(node))
          ),
        };
```

- [ ] **Step 4: Await in get_node**

```ts
return {
  type: request.type,
  requestId: request.requestId,
  data: await serializeNode(node as SceneNode),
};
```

- [ ] **Step 5: Await inside get_design_context**

`serializeWithDepth` is already `async`, so only the one call changes:

```ts
        const serializeWithDepth = async (
          node: unknown,
          currentDepth: number
        ): Promise<SerializedNode> => {
          const serialized = await serializeNode(node as SceneNode);
```

- [ ] **Step 6: Verify the plugin type-checks and builds**

Run: `cd plugin && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS — no `tsc` output, and a clean bundle

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/code.ts
git commit -m "refactor(plugin): await the async serializer at every call site"
```

---

### Task 6: Verify in Figma and document

Unit tests prove the shapes. They cannot prove that `getMainComponentAsync`, `getStyleByIdAsync` and `getVariableByIdAsync` behave the way this plan assumes inside a real `dynamic-page` document — that needs a real file with a real design system in it.

**Files:**

- Modify: `README.md` — the Editing Notes section
- Create: `docs/serialized-nodes.md` — a field reference for the enriched shape

**Interfaces:**

- Consumes: the shipped serializer.
- Produces: documentation only.

- [ ] **Step 1: Build and load**

```bash
cd server && bun run build
cd ../plugin && bun run build
```

Then in Figma: _Plugins → Development → Import plugin from manifest_, select `plugin/manifest.json`, and open a **design** file that has at least one published component, one variable collection and one text style.

- [ ] **Step 2: Build the fixture frame**

In the file, make a frame containing: an instance of a component with at least one variant property; a rectangle whose fill is bound to a colour variable; a text node using a named text style; an auto-layout child set to `Fill container`; and a node carrying a Dev Mode annotation.

- [ ] **Step 3: Prove instance identity**

Select the instance and call `get_selection`.

Expected: the node carries `design.mainComponent` with `id`, `key` and `name`, and `design.componentProperties` listing the variant property.

- [ ] **Step 4: Prove token resolution**

Select the variable-bound rectangle and call `get_selection`.

Expected: `design.boundVariables` contains an entry whose `property` is `fills[0]` and whose `variableName` is the token's full path — not a hex string.

- [ ] **Step 5: Prove style and layout intent**

Select the styled text node and the fill-sizing child, and call `get_selection` for each.

Expected: the text node has `design.styles.text` with the style's name; the auto-layout child has `layout.sizingHorizontal` of `"FILL"`.

- [ ] **Step 6: Prove the annotation survives**

Select the annotated node and call `get_selection`.

Expected: `annotations[0].label` matches the note as typed in Dev Mode.

- [ ] **Step 7: Prove the payload has not bloated**

Call `get_document` on a page with a few hundred nodes, before and after this phase if you still have the old build.

Expected: nodes with no component, variable, style or annotation carry none of the new keys. If plain nodes have grown, a helper is returning an empty object; fix it at the source.

- [ ] **Step 8: Write the field reference**

Create `docs/serialized-nodes.md` documenting the enriched shape: the `design` block (`mainComponent`, `componentProperties`, `key`, `propertyDefinitions`, `propertyOwnerId`, `boundVariables`, `styles`), then `layout`, `reactions`, `annotations`, `exportSettings` and `renderBounds`. For each, state when it is present and when it is omitted — the omission rules are the part readers will get wrong.

- [ ] **Step 9: Document the change in the README**

Append to the Editing Notes bullet list in `README.md`:

```markdown
- Serialized nodes carry design-system identity, not just geometry: instances report their main component and set properties, fills bound to variables report the token name, named styles report the style name, and auto-layout children report hug/fill intent. Fields are omitted when a node carries nothing for them, so plain nodes serialize exactly as before. See [docs/serialized-nodes.md](docs/serialized-nodes.md).
```

- [ ] **Step 10: Format and run everything**

```bash
bun run format
cd plugin && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

Expected: PASS — Prettier reports no remaining changes on a second run, tests green, clean build

- [ ] **Step 11: Commit**

```bash
git add README.md docs/serialized-nodes.md
git commit -m "docs: document the enriched serialized node shape"
```

---

## Done when

- `bun test` is green in `plugin/`, with 36 tests covering references, component identity, intent and the serializer.
- `bunx tsc --noEmit` and `bun run build` both succeed in `plugin/`.
- A plain rectangle serializes with exactly the keys it had before this phase — proven by the baseline regression test and re-checked by hand on a real page.
- In a real Figma design file, an instance reports its main component, a variable-bound fill reports its token name, a styled text node reports its style name, a fill-sizing child reports `layout.sizingHorizontal`, and an annotated node reports its label.
- `docs/serialized-nodes.md` documents every new field and, for each, when it is omitted.
