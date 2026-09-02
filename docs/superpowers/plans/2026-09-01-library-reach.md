# Library Reach and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bridge see past the file the plugin happens to be open in — published team libraries, the components and variables they contain, importing them by key — and report who is signed in, while being honest in the tool descriptions about the reach the Plugin API does not give us.

**Architecture:** Two new manifest permissions unlock `figma.currentUser` and `figma.teamLibrary`. A small permission-aware error mapper turns Figma's raw refusals into messages that name the permission and the plan requirement. Four tools sit on top, and `search_design_system` is deliberately scoped down — its description opens by saying what it cannot do, because an agent that assumes org-wide search will draw the wrong conclusion from an empty result.

**Tech Stack:** TypeScript, Bun (`bun test`), Zod, `@modelcontextprotocol/sdk`, the Figma Plugin API.

**Spec:** `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md` — this plan implements that spec's **Phase 5** and its requirements R36–R42.

## Global Constraints

- Node `>=20.0.0`; Bun is the package manager and script runner throughout.
- The server is ESM with `"module": "Node16"`: **relative imports inside `server/src` must carry a `.js` extension**. Plugin sources use extensionless relative imports.
- Prettier 3.9.6 formats everything; a Husky `pre-commit` hook runs `lint-staged`.
- **Phase 1's test harness must already be in place**; this plan writes `bun test` files in both packages.
- **New plugin modules must never reference the `figma` global.** They take what they need as parameters, which is what lets them run under Bun.
- **`teamlibrary` is a plan-gated permission.** Team library APIs are not available on every Figma plan, and this plan must not pretend otherwise: every team-library call is wrapped so a refusal produces an actionable message rather than a raw error, and the README says the permission may not be usable on all plans.
- Every new tool registers a Zod schema in `toolInputSchemas` **and** a mapper in `rpcToArgs`, in the same commit.
- **Do not overstate reach in a tool description.** A description that implies org-wide search when the implementation cannot deliver it is a defect, not marketing.
- Never reformat or restructure code outside the files each task lists.

---

### Task 1: Request the manifest permissions [R36]

`plugin/manifest.json` declares `"permissions": []` today, which is why `figma.currentUser` and `figma.teamLibrary` are unreachable. Changing it is one line, but it is user-visible on plugin import, so the README has to explain it in the same commit.

**Files:**

- Modify: `plugin/manifest.json` — the `permissions` array
- Modify: `README.md` — the plugin install section

**Interfaces:**

- Consumes: nothing.
- Produces: `figma.currentUser` and `figma.teamLibrary` become reachable in the plugin sandbox. Tasks 3, 4, 5 and 6 depend on this.

- [ ] **Step 1: Add the permissions**

Replace the empty array in `plugin/manifest.json`:

```json
  "permissions": ["currentuser", "teamlibrary"],
```

Leave every other field alone — `documentAccess`, `editorType`, `networkAccess` and `capabilities` are all still correct.

- [ ] **Step 2: Verify the manifest is still valid JSON and the plugin loads**

Run: `cd plugin && bun run build && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
Expected: PASS — prints `manifest ok` and the build succeeds

Then re-import the plugin in Figma (_Plugins → Development → Import plugin from manifest_) and run it. Figma shows the requested permissions on import; confirm it starts without an error.

- [ ] **Step 3: Explain the permissions in the README**

Add to the plugin install section in `README.md`:

```markdown
The plugin requests two permissions:

- `currentuser` — so `whoami` can report who is signed in.
- `teamlibrary` — so `get_libraries`, `import_library_asset` and `search_design_system` can reach published libraries. Team library APIs are gated by Figma plan; on plans without them these three tools return an explicit "not available on this plan" error and every other tool is unaffected.
```

- [ ] **Step 4: Commit**

```bash
git add plugin/manifest.json README.md
git commit -m "feat(plugin): request currentuser and teamlibrary permissions"
```

---

### Task 2: Permission-aware errors [R41]

Figma refuses a team-library call with a message that tells a human nothing and an agent less. This maps refusals onto messages that name the permission, the plan requirement, and the next step. It is a pure module, so it tests without Figma.

**Files:**

- Create: `plugin/src/main/permissions.ts`
- Create: `plugin/src/main/permissions.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `describeApiError(error, api): string` and `withPermissionContext(api, fn): Promise<T>`. Tasks 3, 4, 5 and 6 wrap every permission-gated call in `withPermissionContext`.

- [ ] **Step 1: Write the failing test**

_plugin/src/main/permissions.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { describeApiError, withPermissionContext } from "./permissions";

describe("describeApiError", () => {
  test("names the permission when the manifest is missing it", () => {
    const message = describeApiError(new Error("Missing permission: teamlibrary"), "teamLibrary");
    expect(message).toContain("teamlibrary");
    expect(message).toContain("manifest.json");
  });

  test("names the plan requirement when the API is plan-gated", () => {
    const message = describeApiError(
      new Error("This API is only available in Organization and Enterprise plans"),
      "teamLibrary"
    );
    expect(message).toMatch(/plan/i);
    expect(message).toContain("teamLibrary");
  });

  test("keeps an unrelated error readable rather than reinterpreting it", () => {
    const message = describeApiError(new TypeError("nope"), "currentUser");
    expect(message).toBe("TypeError: nope");
  });

  test("handles a thrown non-Error", () => {
    expect(describeApiError("boom", "currentUser")).toBe("boom");
  });
});

describe("withPermissionContext", () => {
  test("passes a successful result through", async () => {
    expect(await withPermissionContext("teamLibrary", async () => 42)).toBe(42);
  });

  test("rethrows with the mapped message", async () => {
    const failing = withPermissionContext("teamLibrary", async () => {
      throw new Error("Missing permission: teamlibrary");
    });
    await expect(failing).rejects.toThrow(/manifest\.json/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/permissions.test.ts`
Expected: FAIL — `Cannot find module './permissions'`

- [ ] **Step 3: Write the implementation**

_plugin/src/main/permissions.ts — create_

```ts
/**
 * Turns Figma's refusals into messages an agent can act on.
 *
 * A raw "Missing permission" or "only available in Organization plans" tells
 * the caller nothing about what to do next, and an agent will usually retry the
 * same call. Naming the permission, the plan and the next step stops that.
 */

/** The permission-gated API surfaces this plugin touches. */
export type GatedApi = "teamLibrary" | "currentUser";

const MANIFEST_PERMISSION: Record<GatedApi, string> = {
  teamLibrary: "teamlibrary",
  currentUser: "currentuser",
};

/**
 * Maps a thrown value to an actionable message.
 * @param error - Whatever was thrown.
 * @param api - The API surface the call belonged to.
 * @returns The message to surface, unchanged when the error is unrelated.
 */
export const describeApiError = (error: unknown, api: GatedApi): string => {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const text = error instanceof Error ? error.message : String(error);

  if (/missing permission/i.test(text)) {
    return (
      `Figma refused the ${api} call because the plugin does not have the ` +
      `"${MANIFEST_PERMISSION[api]}" permission. Add it to the "permissions" array in ` +
      `plugin/manifest.json, rebuild the plugin, and re-import it in Figma.`
    );
  }

  if (/organization|enterprise|plan/i.test(text)) {
    return (
      `Figma refused the ${api} call because it is not available on this account's plan. ` +
      `Team library APIs require an Organization or Enterprise plan. ` +
      `Every other bridge tool still works; use the file the plugin is open in instead.`
    );
  }

  return raw;
};

/**
 * Runs a permission-gated call and rethrows with an actionable message.
 * @param api - The API surface being called.
 * @param fn - The call.
 */
export const withPermissionContext = async <T>(api: GatedApi, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    throw new Error(describeApiError(error, api));
  }
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/permissions.test.ts`
Expected: PASS — 6 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/permissions.ts plugin/src/main/permissions.test.ts
git commit -m "feat(plugin): map permission and plan refusals to actionable errors"
```

---

### Task 3: `whoami` [R37]

The smallest tool in the phase, and the one that proves task 1 worked. `figma.currentUser` can be `null` even with the permission granted, so the null path is the behaviour worth specifying.

**Files:**

- Modify: `plugin/src/main/code.ts` — `RequestType` union and a new case
- Modify: `server/src/schema.ts` — schema and `rpcToArgs` entry
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: `withPermissionContext` from `./permissions`.
- Produces: a bridge request `whoami` returning `{ user: { id, name, photoUrl } | null, note?: string }`, and the MCP tool that wraps it.

- [ ] **Step 1: Add the plugin case**

Add `"whoami"` to the `RequestType` union in `plugin/src/main/code.ts`, import `withPermissionContext` from `./permissions`, and add the case before `default:`:

```ts
      case "whoami": {
        const user = await withPermissionContext("currentUser", async () => figma.currentUser);
        if (!user) {
          return {
            type: request.type,
            requestId: request.requestId,
            data: {
              user: null,
              note:
                "No current user is available. This happens when the plugin runs without the " +
                '"currentuser" permission, or in a context where Figma does not expose one.',
            },
          };
        }
        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            user: { id: user.id, name: user.name, photoUrl: user.photoUrl },
          },
        };
      }
```

`whoami` is a read, so do **not** add it to `EDIT_REQUEST_TYPES` — it should work in Dev Mode.

- [ ] **Step 2: Add the schema and mapper**

In `server/src/schema.ts`:

```ts
  whoami: z.object({
    fileKey: fileKeyField,
  }),
```

```ts
  whoami: (_nodeIds, params) => ({ ...params }),
```

- [ ] **Step 3: Register the tool**

In `server/src/tools.ts`:

```ts
server.tool(
  "whoami",
  "Report the Figma user signed in to the connected plugin. Returns null with an explanation when no user is available.",
  toolInputSchemas.whoami.shape,
  async ({ fileKey }): Promise<ToolResult> => {
    return renderResponse(() => node.send("whoami", undefined, fileKey));
  }
);
```

- [ ] **Step 4: Verify both halves build**

Run: `cd server && bun run build && cd ../plugin && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS — no errors from either

- [ ] **Step 5: Prove it in Figma**

With the rebuilt plugin running, call `whoami`.

Expected: your Figma display name and user id. If it returns `null` with the note, the manifest permission did not take — re-import the plugin rather than debugging the tool.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/code.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat: add whoami"
```

---

### Task 4: `get_libraries` [R38]

The Plugin API exposes published **variable collections** per library, not a general catalogue. That shape is what the tool returns, and the description says so rather than implying more.

**Files:**

- Modify: `plugin/src/main/code.ts` — `RequestType` union and a new case
- Modify: `server/src/schema.ts` — schema and `rpcToArgs` entry
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: `withPermissionContext` from `./permissions`.
- Produces: a bridge request `get_libraries` returning `{ libraries: Array<{ name, collections: Array<{ key, name }> }> }`. Tasks 5 and 6 rely on the collection `key` being present.

- [ ] **Step 1: Add the plugin case**

```ts
      case "get_libraries": {
        const collections = await withPermissionContext("teamLibrary", () =>
          figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()
        );

        // The API returns a flat list tagged with its library; group it so the
        // caller sees libraries rather than a wall of collections.
        const byLibrary = new Map<string, Array<{ key: string; name: string }>>();
        for (const collection of collections) {
          const bucket = byLibrary.get(collection.libraryName) ?? [];
          bucket.push({ key: collection.key, name: collection.name });
          byLibrary.set(collection.libraryName, bucket);
        }

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            libraries: [...byLibrary.entries()].map(([name, collectionList]) => ({
              name,
              collections: collectionList,
            })),
            note:
              "The Plugin API exposes published variable collections per library. " +
              "It does not expose a full component catalogue; use search_design_system for components.",
          },
        };
      }
```

- [ ] **Step 2: Add the schema and mapper**

```ts
  get_libraries: z.object({
    fileKey: fileKeyField,
  }),
```

```ts
  get_libraries: (_nodeIds, params) => ({ ...params }),
```

- [ ] **Step 3: Register the tool**

```ts
server.tool(
  "get_libraries",
  "List the published team libraries reachable from the connected file, with their published variable collections. Note: the Figma Plugin API exposes variable collections per library, not a full component catalogue — this tool cannot enumerate every published component. Requires the teamlibrary permission and a Figma plan that allows team library APIs.",
  toolInputSchemas.get_libraries.shape,
  async ({ fileKey }): Promise<ToolResult> => {
    return renderResponse(() => node.send("get_libraries", undefined, fileKey));
  }
);
```

- [ ] **Step 4: Verify the build**

Run: `cd server && bun run build && cd ../plugin && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — no errors

- [ ] **Step 5: Prove both paths in Figma**

Call `get_libraries` from a file that has a published library enabled.

Expected: either the grouped list, or — on a plan without team library APIs — the plan message from task 2, naming the plan requirement. Both are correct outcomes; a raw Figma error is not.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/code.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat: add get_libraries"
```

---

### Task 5: Import by key [R39]

Four importable kinds, one tool. Returning the imported object's id is the whole point — without it the next call has nothing to place or bind.

**Files:**

- Modify: `plugin/src/main/code.ts` — `RequestType` union, `ServerRequestParams`, and a new case
- Modify: `server/src/schema.ts` — schema and `rpcToArgs` entry
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: `withPermissionContext` from `./permissions`.
- Produces: a bridge request `import_library_asset` with `params: { kind, key }` returning `{ kind, id, name, type }`.

- [ ] **Step 1: Add `kind` and `key` to the params type**

In `ServerRequestParams` in `plugin/src/main/code.ts`:

```ts
  kind?: "component" | "componentSet" | "style" | "variable";
  key?: string;
```

- [ ] **Step 2: Add the plugin case**

Import is a write — it brings an object into the document — so add `"import_library_asset"` to `EDIT_REQUEST_TYPES` as well as the `RequestType` union.

```ts
      case "import_library_asset": {
        const kind = request.params?.kind;
        const key = request.params?.key;
        if (typeof key !== "string" || key === "") {
          throw new Error("import_library_asset requires a `key` string parameter.");
        }

        const imported = await withPermissionContext("teamLibrary", async () => {
          switch (kind) {
            case "component":
              return figma.importComponentByKeyAsync(key);
            case "componentSet":
              return figma.importComponentSetByKeyAsync(key);
            case "style":
              return figma.importStyleByKeyAsync(key);
            case "variable":
              return figma.variables.importVariableByKeyAsync(key);
            default:
              throw new Error(
                `Unknown kind "${String(kind)}". Use one of: component, componentSet, style, variable.`
              );
          }
        });

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            kind,
            id: imported.id,
            name: imported.name,
            type: (imported as { type?: string }).type,
          },
        };
      }
```

- [ ] **Step 3: Add the schema and mapper**

```ts
  import_library_asset: z.object({
    kind: z
      .enum(["component", "componentSet", "style", "variable"])
      .describe("What to import. Use the kind that matches the key you have."),
    key: z
      .string()
      .min(1)
      .describe("The published key. Component keys come from get_code_connect_map or a serialized node's design.key; variable collection keys come from get_libraries."),
    fileKey: fileKeyField,
  }),
```

```ts
  import_library_asset: (_nodeIds, params) => ({ ...params }),
```

- [ ] **Step 4: Register the tool**

```ts
server.tool(
  "import_library_asset",
  "Import a published component, component set, style or variable into the connected file by its key, and return the imported object's id. Use the returned id to place an instance or bind a variable. Requires the teamlibrary permission; the file must be editable, so this is rejected in Dev Mode.",
  toolInputSchemas.import_library_asset.shape,
  async ({ kind, key, fileKey }): Promise<ToolResult> => {
    return renderResponse(() =>
      node.sendWithParams("import_library_asset", undefined, { kind, key }, fileKey)
    );
  }
);
```

- [ ] **Step 5: Verify the build**

Run: `cd server && bun run build && cd ../plugin && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS — no errors

- [ ] **Step 6: Prove it in Figma**

Get a published component's key from `get_libraries` or from a serialized instance's `design.mainComponent.key`, then call `import_library_asset` with `kind: "component"`.

Expected: an id back. Then use `run_script` from phase 1 to create an instance from it, confirming the id is usable:

```js
const component = await figma.getNodeByIdAsync("<returned id>");
const instance = component.createInstance();
figma.currentPage.appendChild(instance);
return { createdNodeIds: [instance.id] };
```

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/code.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat: import published library assets by key"
```

---

### Task 6: `search_design_system` [R40]

This is where honesty matters more than capability. The Plugin API has no full-text search across an organisation's published libraries, so the bridge searches what it can actually reach: published variable collections, and components present or instantiated in the connected files. The description opens by saying so — otherwise an agent reads an empty result as "your design system has no button".

**Files:**

- Create: `plugin/src/main/search.ts`
- Create: `plugin/src/main/search.test.ts`
- Modify: `plugin/src/main/code.ts` — `RequestType` union, `ServerRequestParams`, and a new case
- Modify: `server/src/schema.ts` — schema and `rpcToArgs` entry
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: nothing.
- Produces: `matchesQuery(query, name): boolean` and `rankResults(query, candidates): SearchHit[]`, plus the `SearchCandidate` and `SearchHit` types.

- [ ] **Step 1: Write the failing test**

_plugin/src/main/search.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { matchesQuery, rankResults } from "./search";

const candidates = [
  { name: "Button/Primary", kind: "component" as const, id: "1:1" },
  { name: "Button/Secondary", kind: "component" as const, id: "1:2" },
  { name: "Card", kind: "component" as const, id: "1:3" },
  { name: "color/button/bg", kind: "variableCollection" as const, id: "VC:1" },
];

describe("matchesQuery", () => {
  test("matches case-insensitively", () => {
    expect(matchesQuery("button", "Button/Primary")).toBe(true);
  });

  test("matches a path segment", () => {
    expect(matchesQuery("primary", "Button/Primary")).toBe(true);
  });

  test("ignores separators in the query", () => {
    expect(matchesQuery("button primary", "Button/Primary")).toBe(true);
  });

  test("does not match unrelated names", () => {
    expect(matchesQuery("button", "Card")).toBe(false);
  });
});

describe("rankResults", () => {
  test("ranks an exact segment match above a substring match", () => {
    const hits = rankResults("button", candidates);
    expect(hits[0].name.startsWith("Button")).toBe(true);
  });

  test("returns every match, not just the first", () => {
    expect(rankResults("button", candidates)).toHaveLength(3);
  });

  test("returns an empty list rather than a bad guess", () => {
    expect(rankResults("zzz", candidates)).toEqual([]);
  });

  test("keeps the kind so the caller knows what it found", () => {
    const hit = rankResults("color", candidates)[0];
    expect(hit.kind).toBe("variableCollection");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/search.test.ts`
Expected: FAIL — `Cannot find module './search'`

- [ ] **Step 3: Write the implementation**

_plugin/src/main/search.ts — create_

```ts
/**
 * Ranking for `search_design_system`.
 *
 * Deliberately narrow: the Plugin API has no full-text search across published
 * libraries, so this ranks whatever the caller could actually enumerate. Kept
 * pure so it tests under Bun.
 */

export interface SearchCandidate {
  id: string;
  name: string;
  kind: "component" | "componentSet" | "variableCollection";
  libraryName?: string;
}

export interface SearchHit extends SearchCandidate {
  /** 0-1; higher is a stronger match. */
  score: number;
}

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const segments = (name: string): string[] => name.split("/").map(normalise).filter(Boolean);

/**
 * Reports whether a name matches a query, ignoring case and separators.
 * @param query - The caller's search text.
 * @param name - The candidate's name, possibly a `Group/Name` path.
 */
export const matchesQuery = (query: string, name: string): boolean => {
  const needle = normalise(query);
  if (needle === "") return false;
  if (normalise(name).includes(needle)) return true;
  return segments(name).some((segment) => segment.includes(needle) || needle.includes(segment));
};

/**
 * Ranks candidates against a query.
 * @param query - The caller's search text.
 * @param candidates - Everything the caller could enumerate.
 * @returns Matching candidates, strongest first. Empty when nothing matches.
 */
export const rankResults = (query: string, candidates: SearchCandidate[]): SearchHit[] => {
  const needle = normalise(query);
  if (needle === "") return [];

  return candidates
    .filter((candidate) => matchesQuery(query, candidate.name))
    .map((candidate) => {
      const parts = segments(candidate.name);
      const exactSegment = parts.some((segment) => segment === needle);
      const startsWith = normalise(candidate.name).startsWith(needle);
      const score = exactSegment ? 1 : startsWith ? 0.8 : 0.5;
      return { ...candidate, score };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/search.test.ts`
Expected: PASS — 8 pass, 0 fail

- [ ] **Step 5: Add the plugin case**

Add `"search_design_system"` to the `RequestType` union and `query?: string;` to `ServerRequestParams`, then:

```ts
      case "search_design_system": {
        const query = request.params?.query;
        if (typeof query !== "string" || query.trim() === "") {
          throw new Error("search_design_system requires a non-empty `query` string parameter.");
        }

        const candidates: SearchCandidate[] = [];

        // Components reachable in the open file.
        for (const node of figma.currentPage.findAllWithCriteria({
          types: ["COMPONENT", "COMPONENT_SET"],
        })) {
          candidates.push({
            id: node.id,
            name: node.name,
            kind: node.type === "COMPONENT_SET" ? "componentSet" : "component",
          });
        }

        // Published variable collections, when the plan allows it.
        try {
          const collections = await withPermissionContext("teamLibrary", () =>
            figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()
          );
          for (const collection of collections) {
            candidates.push({
              id: collection.key,
              name: collection.name,
              kind: "variableCollection",
              libraryName: collection.libraryName,
            });
          }
        } catch {
          // Team library reach is optional; local results are still useful.
        }

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            results: rankResults(query, candidates),
            searched: ["components on the current page", "published variable collections"],
            note:
              "This search covers the connected file and published variable collections only. " +
              "The Figma Plugin API cannot full-text search an organisation's published components, " +
              "so an empty result does not mean the component does not exist.",
          },
        };
      }
```

- [ ] **Step 6: Add the schema, mapper and tool**

```ts
  search_design_system: z.object({
    query: z.string().min(1).describe("Name or partial name to search for."),
    fileKey: fileKeyField,
  }),
```

```ts
  search_design_system: (_nodeIds, params) => ({ ...params }),
```

The description must lead with the limitation:

```ts
server.tool(
  "search_design_system",
  "Search the design system reachable from the connected Figma file. IMPORTANT SCOPE: this covers components on the current page and published variable collections only — the Figma Plugin API cannot full-text search an organisation's published component libraries, so an empty result does NOT mean the component does not exist. Ask the user to open the library file with the plugin if you need to search it.",
  toolInputSchemas.search_design_system.shape,
  async ({ query, fileKey }): Promise<ToolResult> => {
    return renderResponse(() =>
      node.sendWithParams("search_design_system", undefined, { query }, fileKey)
    );
  }
);
```

- [ ] **Step 7: Verify the build and prove the scope note**

Run: `cd server && bun run build && cd ../plugin && bun run test && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — no errors, all plugin tests green

Then call `search_design_system` with a query that matches nothing.

Expected: an empty `results` array **and** the note explaining that an empty result is not proof of absence.

- [ ] **Step 8: Commit**

```bash
git add plugin/src/main/search.ts plugin/src/main/search.test.ts plugin/src/main/code.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat: add a scoped search_design_system"
```

---

### Task 7: Verify and document [R42]

Four tools, two of which depend on a plan the developer running this plan may not have. The verification has to cover both outcomes, and the documentation has to set expectations so nobody files the plan limit as a bug.

**Files:**

- Modify: `README.md` — tool table and Editing Notes
- Create: `docs/libraries.md`

**Interfaces:**

- Consumes: the four shipped tools.
- Produces: documentation only.

- [ ] **Step 1: Confirm the whole suite is green**

Run: `cd plugin && bun run test && cd ../server && bun run test`
Expected: PASS — plugin and server suites both green, including the permissions and search modules from this phase

- [ ] **Step 2: Verify on a plan with team library APIs**

If you have an Organization or Enterprise account, run `whoami`, `get_libraries`, `import_library_asset` and `search_design_system` against a file with a published library enabled.

Expected: real data from each; the imported id creates a working instance.

- [ ] **Step 3: Verify the refusal path**

On an account without team library APIs — or by temporarily removing `teamlibrary` from `plugin/manifest.json`, rebuilding and re-importing — call `get_libraries`.

Expected: the message from task 2 naming the permission or the plan and the next step, not a raw Figma error. Restore the manifest afterwards and rebuild.

- [ ] **Step 4: Verify graceful degradation of search**

With `teamlibrary` unavailable, call `search_design_system` for a component that exists on the current page.

Expected: the local component is still found. Losing library reach must not break the tool.

- [ ] **Step 5: Write the guide**

Create `docs/libraries.md` covering: the two manifest permissions and what each unlocks; that team library APIs are plan-gated and what happens when they are not available; what `get_libraries` returns and why it is collections rather than a catalogue; the four kinds `import_library_asset` accepts and where each key comes from; and — most importantly — `search_design_system`'s real scope, with the sentence an agent needs: an empty result is not proof of absence, and the fix is to ask the user to open the library file with the plugin.

- [ ] **Step 6: Update the README**

Add four rows to the tool table:

```markdown
| `whoami` | Report the Figma user signed in to the connected plugin |
| `get_libraries` | List published team libraries and their variable collections ([guide](docs/libraries.md)) |
| `import_library_asset` | Import a published component, component set, style or variable by key |
| `search_design_system` | Search components on the current page and published variable collections — scoped, see the guide |
```

And append to Editing Notes:

```markdown
- Team library tools (`get_libraries`, `import_library_asset`, `search_design_system`) need the `teamlibrary` permission and a Figma plan that allows team library APIs. Without them these three return an explicit error naming the requirement; every other tool is unaffected. `search_design_system` is narrower than Figma's own: the Plugin API cannot full-text search published component libraries, so an empty result is not proof a component does not exist.
```

- [ ] **Step 7: Format and run everything**

```bash
bun run format
cd server && bun run test && bun run build
cd ../plugin && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

Expected: PASS — Prettier reports no remaining changes on a second run, both suites green, both builds clean

- [ ] **Step 8: Commit**

```bash
git add README.md docs/libraries.md
git commit -m "docs: document library reach, its permissions and its limits"
```

---

## Done when

- `bun test` is green in both packages, covering the permission mapper and the search ranker.
- `bun run build` succeeds in both packages and the plugin type-checks.
- `whoami` returns the signed-in user, or `null` with an explanation.
- `get_libraries` returns grouped collections, or the plan message — never a raw Figma error.
- `import_library_asset` returns an id that `run_script` can turn into a working instance.
- `search_design_system` finds local components with team library reach unavailable, and always returns the scope note.
- `docs/libraries.md` states the plan gating and, in plain words, that an empty search result is not proof of absence.
