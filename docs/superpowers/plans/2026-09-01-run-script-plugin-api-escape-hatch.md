# `run_script` — Plugin API Escape Hatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the bridge a `run_script` MCP tool that executes arbitrary JavaScript against the Figma Plugin API inside the connected file and returns the script's value — the equivalent of the official Figma MCP server's `use_figma`.

**Architecture:** The MCP server gains one more pass-through tool that ships a `code` string over the existing WebSocket bridge. The plugin's request dispatcher hands that string to a new script runner, which evaluates `(async () => { <code> })` with **direct** `eval` (so the sandbox's scope proxy resolves `figma`), awaits the result, and returns a bounded, JSON-safe serialization of it. All the interesting logic — result sanitization and the runner's guard rails — lives in two small, dependency-free plugin modules that are unit-testable without a Figma runtime.

**Tech Stack:** TypeScript, Bun (package manager + `bun test`), Zod (MCP input schemas), `@modelcontextprotocol/sdk`, `ws`, Vite (plugin bundling), `@figma/plugin-typings`.

**Spec:** `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md` — this plan implements that spec's **Phase 1** and its requirements R1–R10.

## Global Constraints

- Node `>=20.0.0` (`server/package.json` `engines`); `.nvmrc` pins the CI version.
- Bun is the package manager and script runner throughout — never `npm`/`yarn`.
- Server is ESM with `"module": "Node16"`: **relative imports inside `server/src` must carry a `.js` extension** (e.g. `./schema.js`). Plugin sources use extensionless relative imports (e.g. `./serializer`).
- Prettier 3.9.6 formats everything; a Husky `pre-commit` hook runs `lint-staged`. Do not fight the formatter — run `bun run format` from the repo root if a commit reformats your file.
- Script character cap: **100000**. Result JSON character cap: **200000**. Result depth cap: **12**. Array item cap per array: **500**. These exact numbers appear in both the plugin runner and the server schema.
- The tool is named exactly `run_script` on every layer: MCP tool name, `toolInputSchemas` key, `rpcToArgs` key, plugin `RequestType` member, and `switch` case.
- `server/src/schema.ts` types `rpcToArgs` as `Record<ToolName, …>`, so adding a key to `toolInputSchemas` without adding the matching `rpcToArgs` entry is a **compile error**. Both land in the same task.
- Never reformat or restructure code outside the files each task lists.

---

### Task 1: Test harness

The repo has no test runner and no tests. Everything downstream is TDD, so this comes first. The task is only complete when `bun test` runs real assertions in both packages and `bun run build` still emits a clean `dist/`.

**Files:**

- Modify: `server/package.json` (add a `test` script)
- Modify: `server/tsconfig.json` (exclude test files from the published build)
- Modify: `plugin/package.json` (add a `test` script)
- Modify: `plugin/tsconfig.json` (exclude test files from `tsc --noEmit`)
- Test: `server/src/schema.test.ts` (create)

**Interfaces:**

- Consumes: `validateRpc(tool, nodeIds?, params?)` from `server/src/schema.ts`, already exported, returning `{ error: string | null; params?: Record<string, unknown> }`.
- Produces: a working `bun test` in `server/` and `plugin/`. Every later task writes its tests against this harness.

- [ ] **Step 1: Write the failing test**

Create `server/src/schema.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { validateRpc } from "./schema.js";

describe("validateRpc", () => {
  test("accepts a well-formed get_node request", () => {
    const result = validateRpc("get_node", ["4029:12345"]);
    expect(result.error).toBeNull();
  });

  test("rejects a hyphenated node id", () => {
    const result = validateRpc("get_node", ["4029-12345"]);
    expect(result.error).toContain("colon format");
  });

  test("passes through tools that have no schema", () => {
    const result = validateRpc("not_a_real_tool");
    expect(result.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm the harness is not wired up yet**

Run: `cd server && bun run test`
Expected: FAIL — `error: Script not found "test"` (the script does not exist yet).

- [ ] **Step 3: Add the `test` script to `server/package.json`**

In the `"scripts"` object, add `"test"` beside the existing `"build"`:

```json
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "prepublishOnly": "bun run build"
  },
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun run test`
Expected: PASS — 3 pass, 0 fail.

- [ ] **Step 5: Keep test files out of the published build**

`server/tsconfig.json` has `"include": ["src/**/*"]`, so `tsc` would compile `schema.test.ts` into `dist/` and ship it on npm. Add an `exclude` alongside `include`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 6: Verify the build is clean and test-free**

Run: `cd server && bun run build && ls dist`
Expected: PASS — `dist/` contains `index.js`, `schema.js`, `tools.js`, … and **no** `schema.test.js`.

- [ ] **Step 7: Add the `test` script to `plugin/package.json`**

Later tasks put their tests in `plugin/src/main/`. Add `"test"` to the plugin's `"scripts"`:

```json
  "scripts": {
    "dev": "concurrently \"vite build --watch\" \"vite build --watch -c vite.config.main.ts\"",
    "build": "vite build && vite build -c vite.config.main.ts",
    "test": "bun test"
  },
```

- [ ] **Step 8: Keep test files out of the plugin's type-check**

`plugin/tsconfig.json` sets `"types": ["@figma/plugin-typings"]`, which loads _only_ those ambient types — so `import ... from "bun:test"` in a file under `src` makes `tsc --noEmit` fail with `Cannot find module 'bun:test'`. Bun type-checks nothing at test time, so the fix is to exclude test files from `tsc`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["@figma/plugin-typings"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 9: Confirm the plugin harness runs and still type-checks**

Run: `cd plugin && bun run test && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — `0 pass, 0 fail` with no error about a missing `test` script, and no `tsc` output. (Bun exits 0 when it finds no test files.)

- [ ] **Step 10: Commit**

```bash
git add server/package.json server/tsconfig.json server/src/schema.test.ts plugin/package.json plugin/tsconfig.json
git commit -m "test: add bun test harness for server and plugin"
```

---

### Task 2: JSON-safe result serialization

A script can return anything — a Figma node, `figma.mixed`, a cyclic object, a 40 MB tree. This module turns any value into something `JSON.stringify` handles and the agent can read, with hard bounds. It is pure and has no `figma` dependency, so it is fully unit-testable under Bun.

Implements spec requirements **R3** and the depth/array halves of **R4**.

**Files:**

- Create: `plugin/src/main/script-result.ts`
- Test: `plugin/src/main/script-result.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `toJsonSafe(value: unknown): unknown`
  - `MAX_RESULT_DEPTH: 12`, `MAX_ARRAY_ITEMS: 500` (exported consts)

  Task 3 imports `toJsonSafe` from `./script-result`.

- [ ] **Step 1: Write the failing test**

Create `plugin/src/main/script-result.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { MAX_ARRAY_ITEMS, MAX_RESULT_DEPTH, toJsonSafe } from "./script-result";

/** Minimal stand-in for a Figma SceneNode: id + type + setPluginData. */
const fakeNode = (id: string, name: string, type: string) => ({
  id,
  name,
  type,
  width: 100,
  setPluginData() {},
  getPluginData() {
    return "";
  },
});

describe("toJsonSafe", () => {
  test("passes primitives through untouched", () => {
    expect(toJsonSafe("hi")).toBe("hi");
    expect(toJsonSafe(42)).toBe(42);
    expect(toJsonSafe(true)).toBe(true);
    expect(toJsonSafe(null)).toBeNull();
    expect(toJsonSafe(undefined)).toBeUndefined();
  });

  test("collapses a Figma node to id, name and type", () => {
    expect(toJsonSafe(fakeNode("1:2", "Card", "FRAME"))).toEqual({
      id: "1:2",
      name: "Card",
      type: "FRAME",
    });
  });

  test("collapses nodes nested inside plain objects and arrays", () => {
    const value = { created: [fakeNode("1:2", "Card", "FRAME")], count: 1 };
    expect(toJsonSafe(value)).toEqual({
      created: [{ id: "1:2", name: "Card", type: "FRAME" }],
      count: 1,
    });
  });

  test('renders symbols as "mixed" (figma.mixed is a symbol)', () => {
    expect(toJsonSafe({ strokeWeight: Symbol("figma.mixed") })).toEqual({
      strokeWeight: "mixed",
    });
  });

  test("replaces circular references instead of throwing", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(toJsonSafe(a)).toEqual({ name: "a", self: "[circular]" });
  });

  test("does not treat a repeated sibling reference as circular", () => {
    const shared = { k: 1 };
    expect(toJsonSafe({ x: shared, y: shared })).toEqual({ x: { k: 1 }, y: { k: 1 } });
  });

  test("stops at the depth cap", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < MAX_RESULT_DEPTH + 2; i++) deep = { next: deep };
    expect(JSON.stringify(toJsonSafe(deep))).toContain("[max depth]");
  });

  test("caps long arrays and reports how many were dropped", () => {
    const long = Array.from({ length: MAX_ARRAY_ITEMS + 5 }, (_, i) => i);
    const out = toJsonSafe(long) as unknown[];
    expect(out).toHaveLength(MAX_ARRAY_ITEMS + 1);
    expect(out[MAX_ARRAY_ITEMS]).toBe("[+5 more]");
  });

  test("stringifies values JSON cannot represent", () => {
    expect(toJsonSafe({ fn: () => 1 })).toEqual({ fn: "[function]" });
    expect(toJsonSafe({ big: 10n })).toEqual({ big: "10" });
    expect(toJsonSafe({ n: Number.NaN })).toEqual({ n: "NaN" });
    expect(toJsonSafe({ n: Number.POSITIVE_INFINITY })).toEqual({ n: "Infinity" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/script-result.test.ts`
Expected: FAIL — `Cannot find module './script-result'`.

- [ ] **Step 3: Write the implementation**

Create `plugin/src/main/script-result.ts`:

```ts
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
    for (const key of Object.keys(value)) {
      out[key] = toJsonSafeInner((value as Record<string, unknown>)[key], depth + 1, seen);
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/script-result.test.ts`
Expected: PASS — 9 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/script-result.ts plugin/src/main/script-result.test.ts
git commit -m "feat(plugin): add JSON-safe serializer for script results"
```

---

### Task 3: The script runner

This is the piece that actually evaluates user code. Two decisions matter and both come from the spec's feasibility section:

1. **Direct `eval`, not `(0, eval)`.** Figma's sandbox wraps plugin code in `with (scopeProxy) { … }`, so a _direct_ eval inherits the scope chain that makes `figma` resolve. Indirect eval runs in the realm's global scope, where it may not. The direct call is isolated in its own tiny module so the bundler's "direct eval defeats scope optimisation" warning is confined to one file.
2. **Evaluate `(async () => { … })`, then call it.** Wrapping the user's source in an async arrow gives it both top-level `await` and top-level `return`, matching `use_figma`'s contract, without the runner having to parse anything.

Implements spec requirements **R2**, **R5**, **R6**, and the character-cap half of **R4**.

**Files:**

- Create: `plugin/src/main/eval-direct.ts`
- Create: `plugin/src/main/script-runner.ts`
- Test: `plugin/src/main/script-runner.test.ts`

**Interfaces:**

- Consumes: `toJsonSafe` from `./script-result` (Task 2).
- Produces:
  - `evalDirect(source: string): unknown` from `./eval-direct`
  - `runScript(code: string, evaluate?: (source: string) => unknown): Promise<ScriptOutcome>` from `./script-runner`
  - ```ts
    export type ScriptOutcome =
      | { ok: true; value?: unknown }
      | { ok: true; truncated: true; valuePreview: string }
      | { ok: false; error: string };
    ```
  - `MAX_SCRIPT_CHARS: 100000`, `MAX_RESULT_CHARS: 200000`

  Task 4 imports `runScript` and `ScriptOutcome`.

  The optional `evaluate` parameter exists so tests can inject an evaluator; production callers pass nothing and get `evalDirect`.

- [ ] **Step 1: Write the failing test**

Create `plugin/src/main/script-runner.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { MAX_RESULT_CHARS, MAX_SCRIPT_CHARS, runScript } from "./script-runner";

/**
 * Test evaluator. `runScript`'s production default uses *direct* eval so the
 * Figma sandbox's scope proxy is in scope; under Bun there is no sandbox, so
 * indirect eval is both sufficient and safer to reason about.
 */
const evaluate = (source: string): unknown => (0, eval)(source);

describe("runScript", () => {
  test("returns the script's value", async () => {
    expect(await runScript("return 1 + 1", evaluate)).toEqual({ ok: true, value: 2 });
  });

  test("supports top-level await", async () => {
    const outcome = await runScript("const v = await Promise.resolve('done'); return v", evaluate);
    expect(outcome).toEqual({ ok: true, value: "done" });
  });

  test("returns ok with no value when the script returns nothing", async () => {
    expect(await runScript("const unused = 1;", evaluate)).toEqual({ ok: true });
  });

  test("sanitises the returned value", async () => {
    const outcome = await runScript("const o = { name: 'a' }; o.self = o; return o", evaluate);
    expect(outcome).toEqual({ ok: true, value: { name: "a", self: "[circular]" } });
  });

  test("reports a thrown error as name: message", async () => {
    const outcome = await runScript("throw new TypeError('nope')", evaluate);
    expect(outcome).toEqual({ ok: false, error: "TypeError: nope" });
  });

  test("reports a syntax error rather than throwing", async () => {
    const outcome = await runScript("return (", evaluate);
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toContain("SyntaxError");
  });

  test("reports a rejected promise", async () => {
    const outcome = await runScript("await Promise.reject(new Error('async boom'))", evaluate);
    expect(outcome).toEqual({ ok: false, error: "Error: async boom" });
  });

  test("rejects empty code without evaluating anything", async () => {
    const outcome = await runScript("   ", evaluate);
    expect(outcome).toEqual({ ok: false, error: "run_script requires a non-empty `code` string." });
  });

  test("rejects code over the character cap", async () => {
    const outcome = await runScript("//".padEnd(MAX_SCRIPT_CHARS + 1, "x"), evaluate);
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toContain(
      "Split it into smaller run_script calls"
    );
  });

  test("truncates an oversized result instead of returning it whole", async () => {
    const outcome = await runScript(`return "x".repeat(${MAX_RESULT_CHARS + 100})`, evaluate);
    expect(outcome).toMatchObject({ ok: true, truncated: true });
    expect((outcome as { valuePreview: string }).valuePreview).toHaveLength(MAX_RESULT_CHARS);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd plugin && bun test src/main/script-runner.test.ts`
Expected: FAIL — `Cannot find module './script-runner'`.

- [ ] **Step 3: Write the direct-eval shim**

Create `plugin/src/main/eval-direct.ts`:

```ts
/**
 * The one place in the codebase that calls `eval`.
 *
 * This MUST stay a *direct* eval (`eval(source)`), never an indirect one
 * (`(0, eval)(source)`). Figma's plugin sandbox is a Realm that wraps plugin
 * code in `with (scopeProxy) { ... }`; a direct eval inherits that scope chain,
 * which is what makes the `figma` global resolve inside evaluated source.
 * An indirect eval runs in the realm's global scope, where it does not.
 *
 * Bundlers warn that direct eval defeats scope minification. That warning is
 * expected and is why this call lives alone in a module with no imports.
 */
export const evalDirect = (source: string): unknown => eval(source);
```

- [ ] **Step 4: Write the runner**

Create `plugin/src/main/script-runner.ts`:

```ts
import { evalDirect } from "./eval-direct";
import { toJsonSafe } from "./script-result";

/** Largest script accepted, in characters. Mirrored by the server's Zod schema. */
export const MAX_SCRIPT_CHARS = 100_000;

/** Largest serialised result returned in full, in characters. */
export const MAX_RESULT_CHARS = 200_000;

export type ScriptOutcome =
  | { ok: true; value?: unknown }
  | { ok: true; truncated: true; valuePreview: string }
  | { ok: false; error: string };

/**
 * Executes agent-authored JavaScript against the Figma Plugin API.
 *
 * The source is wrapped in an async arrow function before evaluation, so the
 * script gets both top-level `await` and top-level `return`.
 *
 * @param code - The script source.
 * @param evaluate - Evaluator, injectable for tests. Defaults to direct eval.
 * @returns The sanitised script value, or a structured failure.
 */
export const runScript = async (
  code: string,
  evaluate: (source: string) => unknown = evalDirect
): Promise<ScriptOutcome> => {
  if (typeof code !== "string" || code.trim() === "") {
    return { ok: false, error: "run_script requires a non-empty `code` string." };
  }
  if (code.length > MAX_SCRIPT_CHARS) {
    return {
      ok: false,
      error:
        `Script is ${code.length} characters; the limit is ${MAX_SCRIPT_CHARS}. ` +
        `Split it into smaller run_script calls.`,
    };
  }

  let value: unknown;
  try {
    const factory = evaluate(`(async () => {\n${code}\n})`);
    if (typeof factory !== "function") {
      return { ok: false, error: "Script did not compile to a callable function." };
    }
    value = await (factory as () => Promise<unknown>)();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  // Round-trip through JSON so the caller can never post a value the
  // WebSocket layer would choke on, and so the cap is measured on the exact
  // bytes that go on the wire.
  const json = JSON.stringify(toJsonSafe(value));
  if (json === undefined) {
    return { ok: true };
  }
  if (json.length > MAX_RESULT_CHARS) {
    return { ok: true, truncated: true, valuePreview: json.slice(0, MAX_RESULT_CHARS) };
  }
  return { ok: true, value: JSON.parse(json) };
};
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `cd plugin && bun test src/main/script-runner.test.ts`
Expected: PASS — 10 pass, 0 fail.

- [ ] **Step 6: Confirm the plugin still bundles**

Run: `cd plugin && bun run build`
Expected: PASS. A build **warning** mentioning direct `eval` (e.g. `Using direct eval with a bundler is not recommended`) is expected and acceptable — it is why `eval-direct.ts` is isolated. A build _error_ is not; stop and read it.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/eval-direct.ts plugin/src/main/script-runner.ts plugin/src/main/script-runner.test.ts
git commit -m "feat(plugin): add Plugin API script runner"
```

---

### Task 4: Wire `run_script` into the plugin dispatcher

`plugin/src/main/code.ts` routes every bridge request through a `RequestType` union and a `switch`. Add the new type, gate it behind the design-editor check, and hand off to `runScript`.

Implements spec requirements **R6** (errors surface on the error channel) and **R7** (Dev Mode rejection).

**Files:**

- Modify: `plugin/src/main/code.ts` — import block (line 1-2), `RequestType` union (lines 4-39), `ServerRequestParams` (lines 41-58), `EDIT_REQUEST_TYPES` (lines 331-357), and the `handleRequest` switch (add a case before the `default` at line 1838)

**Interfaces:**

- Consumes: `runScript` from `./script-runner` (Task 3).
- Produces: the plugin now answers a bridge request of `type: "run_script"` with `params: { code: string }`, replying with `data: ScriptOutcome` on success and the standard `error` field on failure. Task 6's server tool relies on exactly this shape.

- [ ] **Step 1: Add the import**

At the top of `plugin/src/main/code.ts`, beside the existing imports:

```ts
import { serializeNode } from "./serializer";
import { addLayersToFrame } from "../html-figma/figma";
import { runScript } from "./script-runner";
```

- [ ] **Step 2: Add `run_script` to the `RequestType` union**

Append a member to the union that ends at `| "set_timeline_duration";`:

```ts
  | "set_timeline_duration"
  | "run_script";
```

- [ ] **Step 3: Declare the `code` param**

In the `ServerRequestParams` type, add `code` beside the existing optional fields:

```ts
  timelineId?: string;
  duration?: number;
  code?: string;
};
```

- [ ] **Step 4: Gate it behind the design-editor check**

Add `"run_script"` to the `EDIT_REQUEST_TYPES` set (after `"set_timeline_duration"`):

```ts
  "set_timeline_duration",
  "run_script",
]);
```

Scripts can mutate, and Dev Mode is read-only, so `run_script` gets the same up-front rejection as every other write tool rather than a confusing runtime failure from inside the evaluated code.

- [ ] **Step 5: Add the switch case**

In `handleRequest`, immediately before the `default:` branch:

```ts
      case "run_script": {
        const code = request.params?.code;
        if (typeof code !== "string") {
          throw new Error("run_script requires a `code` string parameter.");
        }
        const outcome = await runScript(code);
        // Surface failures on the response's `error` channel so the MCP layer
        // marks the tool result as an error instead of a successful payload
        // that happens to contain a failure.
        if (!outcome.ok) {
          throw new Error(outcome.error);
        }
        return {
          type: request.type,
          requestId: request.requestId,
          data: outcome,
        };
      }
```

- [ ] **Step 6: Verify the plugin type-checks and builds**

Run: `cd plugin && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS (the direct-`eval` bundler warning from Task 3 is still fine).

- [ ] **Step 7: Verify the existing tests still pass**

Run: `cd plugin && bun run test`
Expected: PASS — 19 pass, 0 fail (9 from Task 2, 10 from Task 3).

- [ ] **Step 8: Commit**

```bash
git add plugin/src/main/code.ts
git commit -m "feat(plugin): dispatch run_script requests to the script runner"
```

---

### Task 5: Server schema and RPC validation

Followers forward tool calls to the leader over HTTP `/rpc`, and `validateRpc` re-validates them there. `rpcToArgs` is typed `Record<ToolName, …>`, so the schema and the mapper must land together or the server will not compile.

Implements spec requirements **R1**, **R5** (server-side half) and **R9**.

**Files:**

- Modify: `server/src/schema.ts` — add `run_script` to `toolInputSchemas` (the object starting at line 593) and to `rpcToArgs` (the map ending at line 960)
- Test: `server/src/schema.test.ts` (extend — created in Task 1)

**Interfaces:**

- Consumes: `fileKeyField` (already defined in `schema.ts`), `validateRpc`.
- Produces: `toolInputSchemas.run_script`, a Zod object with `.shape` `{ code, fileKey }`. Task 6 registers the MCP tool with `toolInputSchemas.run_script.shape` and destructures `{ code, fileKey }`.

- [ ] **Step 1: Write the failing test**

Append to `server/src/schema.test.ts`:

```ts
describe("validateRpc run_script", () => {
  test("accepts a script", () => {
    const result = validateRpc("run_script", undefined, { code: "return figma.root.name" });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ code: "return figma.root.name" });
  });

  test("rejects a missing script", () => {
    expect(validateRpc("run_script", undefined, {}).error).not.toBeNull();
  });

  test("rejects an empty script", () => {
    expect(validateRpc("run_script", undefined, { code: "" }).error).not.toBeNull();
  });

  test("rejects a script over the character cap", () => {
    const result = validateRpc("run_script", undefined, { code: "x".repeat(100_001) });
    expect(result.error).toContain("100000");
  });

  test("drops fileKey from the forwarded params", () => {
    const result = validateRpc("run_script", undefined, { code: "return 1", fileKey: "abc" });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ code: "return 1" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun run test`
Expected: FAIL — `run_script` is not in `rpcInputSchemas`, so `validateRpc` returns `{ error: null }` for every case and the three "rejects" tests fail.

- [ ] **Step 3: Add the input schema**

In `server/src/schema.ts`, inside `toolInputSchemas`, add the entry after the last existing one and before the closing `} as const;`:

```ts
  run_script: z.object({
    code: z
      .string()
      .min(1, "code must not be empty")
      .max(100_000, "code must be at most 100000 characters — split it into smaller run_script calls")
      .describe(
        "JavaScript executed inside the Figma plugin sandbox with the full Plugin API in scope as `figma`. Top-level `await` and top-level `return` are supported."
      ),
    fileKey: fileKeyField,
  }),
```

- [ ] **Step 4: Add the RPC argument mapper**

In the `rpcToArgs` map, add the matching entry (order does not matter; put it after `set_timeline_duration`). `run_script` carries no node IDs, so the mapper just forwards `params`:

```ts
  set_timeline_duration: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  run_script: (_nodeIds, params) => ({ ...params }),
};
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `cd server && bun run test`
Expected: PASS — 8 pass, 0 fail.

- [ ] **Step 6: Verify the server type-checks**

Run: `cd server && bun run build`
Expected: PASS with no `tsc` errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/schema.ts server/src/schema.test.ts
git commit -m "feat(server): validate run_script on the MCP and RPC paths"
```

---

### Task 6: Register the `run_script` MCP tool

The tool handler is a thin pass-through. The substance is the **description**: the agent has no `figma-use`-style skill on this server, so every non-obvious sandbox rule has to reach it through the tool description itself.

Implements spec requirements **R1** and **R8**.

**Files:**

- Modify: `server/src/tools.ts` — add a `RUN_SCRIPT_DESCRIPTION` const near the other module-level constants (beside `MAX_IMAGE_BYTES`, around line 36) and a `server.tool("run_script", …)` registration inside `registerTools`

**Interfaces:**

- Consumes: `toolInputSchemas.run_script` (Task 5); `node.sendWithParams(requestType, nodeIds?, params?, fileKey?)` from `server/src/node.ts`; the existing module-private `renderResponse(fn)` helper.
- Produces: the `run_script` MCP tool. Nothing later in this plan consumes it.

- [ ] **Step 1: Add the description constant**

In `server/src/tools.ts`, after the existing constants near the top of the module:

```ts
const RUN_SCRIPT_DESCRIPTION = `Execute JavaScript against the Figma Plugin API inside the connected file. This is the escape hatch: anything the Plugin API can do — components, variants, instances, variables and modes, styles, boolean operations, vector edits, prototyping, per-segment text styling, arbitrary reads — is reachable here, and nowhere else in this server.

Prefer a dedicated tool when one exists (create_frame, set_auto_layout, get_screenshot, ...); reach for run_script when none does.

RULES — violating these is the usual cause of confusing failures:
- \`return\` is your only output channel. console.log is discarded. Always return the ids of every node you create or mutate, e.g. \`return { createdNodeIds: [...], mutatedNodeIds: [...] }\`.
- Top-level \`await\` and \`return\` are supported. Do NOT wrap your code in an async IIFE, and do NOT call figma.closePlugin().
- Colors are 0-1, not 0-255: \`{ r: 1, g: 0, b: 0 }\` is red.
- \`fills\`/\`strokes\` are read-only arrays — clone, modify, then reassign the whole array.
- Before touching a text node (characters, appendChild, setBoundVariable), load its fonts: read \`node.getStyledTextSegments(['fontName'])\` and \`await figma.loadFontAsync(...)\` each one. Skipping this throws "Cannot write to node with unloaded font".
- Switch pages with \`await figma.setCurrentPageAsync(page)\`. The sync setter throws. Page context resets to the first page on every call.
- \`await\` every promise. An unawaited \`loadFontAsync\` or \`setCurrentPageAsync\` fails silently.
- Work incrementally: several small scripts that you validate between beat one large one.
- SCRIPTS ARE NOT ATOMIC. The Plugin API has no rollback, so a script that throws halfway leaves its earlier mutations in the file. On an error, read the message, inspect the current state, and clean up before retrying — do not blindly re-run.

RESULT SHAPE: \`{ ok: true, value }\` on success, or \`{ ok: true, truncated: true, valuePreview }\` when the serialised value exceeds 200000 characters. Figma nodes in the returned value collapse to \`{ id, name, type }\`; \`figma.mixed\` serialises as "mixed"; cycles become "[circular]". Return ids and read them back rather than returning whole node objects.

LIMITS: 100000 characters of source; results capped at depth 12 and 500 items per array; the bridge times out after 3 minutes. Requires the plugin to be open in Figma's design editor — Dev Mode is read-only and will reject this tool.`;
```

- [ ] **Step 2: Register the tool**

Inside `registerTools`, after the last existing `server.tool(...)` call:

```ts
server.tool(
  "run_script",
  RUN_SCRIPT_DESCRIPTION,
  toolInputSchemas.run_script.shape,
  async ({ code, fileKey }): Promise<ToolResult> => {
    return renderResponse(() => node.sendWithParams("run_script", undefined, { code }, fileKey));
  }
);
```

- [ ] **Step 3: Verify the server builds**

Run: `cd server && bun run build`
Expected: PASS with no `tsc` errors.

- [ ] **Step 4: Verify the tool is advertised over MCP**

Start the built server and ask it for its tool list over stdio:

```bash
cd server
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node dist/index.js 2>/dev/null | grep -o '"name":"run_script"'
```

Expected: prints `"name":"run_script"`. If it prints nothing, the registration did not take — do not proceed.

- [ ] **Step 5: Commit**

```bash
git add server/src/tools.ts
git commit -m "feat(server): register the run_script MCP tool"
```

---

### Task 7: End-to-end verification in Figma, and documentation

Everything so far is verified by unit tests and a stdio probe. Nothing has yet proven that `eval` actually resolves `figma` inside the real sandbox — the one assumption this whole feature rests on. This task proves it by hand and writes down what the feature does.

**Files:**

- Modify: `README.md` — add `run_script` to the Available Tools table and a paragraph under Editing Notes
- Create: `docs/run-script.md` — the long-form guide the README links to

**Interfaces:**

- Consumes: the shipped `run_script` tool.
- Produces: documentation only.

- [ ] **Step 1: Build both halves and load the plugin**

```bash
cd server && bun run build
cd ../plugin && bun run build
```

Then in Figma: `Plugins > Development > Import plugin from manifest`, select `plugin/manifest.json`, open a **design** file (`figma.com/design/...`), and run the plugin. Point your MCP client at `node /path/to/figma-design-relay/server/dist/index.js`.

- [ ] **Step 2: Prove `figma` resolves inside evaluated code**

Call `run_script` with:

```js
return { file: figma.root.name, page: figma.currentPage.name, editor: figma.editorType };
```

Expected: `{ ok: true, value: { file: "<your file name>", page: "Page 1", editor: "figma" } }`.

If this returns `ReferenceError: figma is not defined`, the sandbox is not resolving the global through the direct eval. **Stop.** The fallback is to move evaluation into a `new Function("figma", ...)` call that passes `figma` in explicitly; if `new Function` is also blocked, the feature is not deliverable as designed and the spec needs revisiting.

- [ ] **Step 3: Prove a write works and ids come back**

```js
const frame = figma.createFrame();
frame.name = "run_script smoke test";
frame.resize(200, 120);
frame.x = 0;
frame.y = 0;
figma.currentPage.appendChild(frame);
return { createdNodeIds: [frame.id] };
```

Expected: a 200x120 frame appears on the canvas, and the result is `{ ok: true, value: { createdNodeIds: ["<id>"] } }`.

- [ ] **Step 4: Prove the error path**

```js
return figma.getNodeById("definitely-not-a-node").name;
```

Expected: an MCP **error** result whose text is a `TypeError`/`Error` message — not a successful result containing a failure.

- [ ] **Step 5: Prove the Dev Mode gate**

Switch the same file to Dev Mode, re-run the plugin, and call `run_script` with `return 1`.
Expected: an error reading `run_script requires the plugin to be opened in Figma's design editor (Dev Mode is read-only). Switch to the design editor and re-run.`

- [ ] **Step 6: Clean up the smoke-test frame**

Call `run_script` with (substituting the id from Step 3):

```js
const node = await figma.getNodeByIdAsync("<id from step 3>");
if (node) node.remove();
return { removed: "<id from step 3>" };
```

- [ ] **Step 7: Write the long-form guide**

Create `docs/run-script.md`:

````markdown
# `run_script`

`run_script` executes JavaScript against the [Figma Plugin API](https://developers.figma.com/docs/plugins/api/api-reference/)
inside whichever file has the bridge plugin open. It is the bridge's escape
hatch: the other tools cover common operations with validated inputs, and
`run_script` covers everything else — components and variants, instances and
overrides, variables and modes, styles, boolean operations, vector editing,
prototyping reactions, per-segment text styling, and any read the serializer
does not expose.

Prefer a dedicated tool when one exists. Reach for `run_script` when none does.

## Contract

Your source is wrapped in an async function and called, so you get top-level
`await` and top-level `return`:

```js
const page = figma.currentPage;
const frames = page.findAll((n) => n.type === "FRAME");
return { count: frames.length, ids: frames.map((f) => f.id) };
```

`return` is the only output channel — `console.log` is discarded.

**Always return the ids of nodes you create or mutate.** Returned Figma nodes
collapse to `{ id, name, type }`, so a whole node object tells you almost
nothing; ids let the next call address the same nodes.

## Result shape

| Field                                         | Meaning                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `{ ok: true, value }`                         | Success. `value` is your return value, sanitised.                          |
| `{ ok: true, truncated: true, valuePreview }` | The serialised value exceeded 200000 characters; you get the first 200000. |
| MCP error result                              | The script threw. The text is `ErrorName: message`.                        |

Sanitisation rules: Figma nodes → `{ id, name, type }`; `figma.mixed` and any
other symbol → `"mixed"`; circular references → `"[circular]"`; functions →
`"[function]"`; nesting deeper than 12 → `"[max depth]"`; arrays longer than
500 items are cut with a `"[+N more]"` marker.

## Limits

- Source: 100000 characters.
- Result: 200000 characters, depth 12, 500 array items per array.
- The bridge times out a request after 3 minutes.
- Design editor only. Dev Mode is read-only and rejects `run_script` up front.

## Gotchas

- **Colors are 0-1**, not 0-255. `{ r: 1, g: 0, b: 0 }` is red.
- **`fills` and `strokes` are read-only arrays.** Clone, modify, reassign:
  ```js
  const fills = JSON.parse(JSON.stringify(node.fills));
  fills[0].color = { r: 0.2, g: 0.4, b: 1 };
  node.fills = fills;
  ```
- **Load fonts before touching text.** Any write to a text node — including
  `appendChild` and `setBoundVariable` — throws
  `Cannot write to node with unloaded font "<family> <style>"` unless the node's
  _current_ fonts are loaded first:
  ```js
  const segments = node.getStyledTextSegments(["fontName"]);
  await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)));
  node.characters = "Hello";
  return { mutatedNodeIds: [node.id] };
  ```
- **Switch pages with `await figma.setCurrentPageAsync(page)`.** The synchronous
  `figma.currentPage = page` setter throws. Page context resets to the first
  page at the start of every call.
- **`await` every promise.** An unawaited `loadFontAsync` or
  `setCurrentPageAsync` fails silently and leaves half-applied changes.
- **Position new top-level nodes away from (0, 0).** Nodes appended straight to
  the page default there and stack on top of each other.
- **Work incrementally.** Several small scripts you validate between are far
  more reliable than one large one.

## Scripts are not atomic

Unlike Figma's own `use_figma`, a failed `run_script` does **not** roll back.
The Plugin API has no transaction or rollback primitive, so a script that
creates three nodes and then throws leaves those three nodes in the file. On an
error: read the message, run a read-only script to inspect the current state,
clean up what was half-created, and only then retry. Do not blindly re-run — that
is how you end up with duplicates.
````

- [ ] **Step 8: Add `run_script` to the README**

In `README.md`, add a row to the Available Tools table immediately after the `delete_nodes` row:

```markdown
| `run_script` | Execute JavaScript against the Figma Plugin API — the escape hatch for anything the other tools do not cover ([guide](docs/run-script.md)) |
```

- [ ] **Step 9: Document the caveats under Editing Notes**

In `README.md`, append to the Editing Notes bullet list:

```markdown
- `run_script` executes agent-authored JavaScript with the full Plugin API in scope. It is the escape hatch for components, variables, styles, boolean operations, prototyping, and any other API the dedicated tools do not cover. Unlike the dedicated tools it is **not atomic** — a script that throws part-way leaves its earlier mutations in the file, because the Plugin API has no rollback. See [docs/run-script.md](docs/run-script.md) for the full contract, limits, and gotchas.
```

- [ ] **Step 10: Format, and run everything one more time**

```bash
bun run format
cd server && bun run test && bun run build
cd ../plugin && bun run test && bun run build
```

Expected: Prettier reports no remaining changes on a second run; server tests 8 pass; plugin tests 19 pass; both builds succeed.

- [ ] **Step 11: Commit**

```bash
git add README.md docs/run-script.md
git commit -m "docs: document run_script"
```

---

## Done when

- `bun test` is green in `server/` and `plugin/` (27 tests total).
- `bun run build` succeeds in both packages and `server/dist` contains no test files.
- `tools/list` over stdio advertises `run_script`.
- In a real Figma design file, `run_script` reads `figma.root.name`, creates and
  removes a frame, surfaces a thrown error as an MCP error, and is rejected in
  Dev Mode.
- `README.md` and `docs/run-script.md` describe the tool, its limits, and its
  non-atomicity.
