# Code Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tie Figma nodes to the real components in the user's codebase, so an agent writing code from a design reaches for _their_ `<Button>` instead of generating a fresh div — using the `*.figma.ts` files already in the repository, with no Figma cloud access at all.

**Architecture:** Everything lives server-side. A discovery pass finds Code Connect files inside the MCP working directory, a hand-written scanner extracts each `figma.connect(...)` call without pulling in a TypeScript parser dependency, and a small index answers lookups by node id. Four tools sit on top, and `get_design_context` consults the index so mappings show up where an agent will actually see them.

**Tech Stack:** TypeScript, Bun (`bun test`), Zod, `@modelcontextprotocol/sdk`, `node:fs/promises`.

**Spec:** `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md` — this plan implements that spec's **Phase 4** and its requirements R28–R35.

## Global Constraints

- Node `>=20.0.0`; Bun is the package manager and script runner throughout.
- The server is ESM with `"module": "Node16"`: **relative imports inside `server/src` must carry a `.js` extension**.
- Prettier 3.9.6 formats everything; a Husky `pre-commit` hook runs `lint-staged`.
- **Phase 2 must have landed** for task 5 — `get_context_for_code_connect` returns component property definitions, which phase 2's R13 adds to the serializer.
- **No new runtime dependency.** The server ships with `@modelcontextprotocol/sdk`, `ws` and `zod`; do not add a TypeScript parser. The scanner in task 3 handles the documented Code Connect shapes and reports anything it cannot read, by path.
- **Containment is not optional.** Every path this plan touches resolves with `realpath` and must stay inside the MCP server's working directory, matching what `import_html_layers` already enforces. A mapping file outside the workspace is a refusal, not a warning.
- **A file that fails to parse is reported, never silently dropped.** Silence here means an agent believes a component is unmapped when it is mapped, and writes a fresh div.
- Every new tool registers a Zod schema in `toolInputSchemas` **and** a mapper in `rpcToArgs`, in the same commit.
- Never reformat or restructure code outside the files each task lists.

---

### Task 1: Figma URL parsing [R29]

Every Code Connect mapping addresses its node by URL. Figma writes node ids with a hyphen in URLs (`node-id=1-2`) and a colon everywhere else (`1:2`), which is exactly the sort of mismatch that produces a lookup that silently never matches.

**Files:**

- Create: `server/src/code-connect/url.ts`
- Create: `server/src/code-connect/url.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `parseFigmaUrl(url): FigmaTarget | null` and the `FigmaTarget` type. Tasks 3 and 7 import them from `./url.js`.

- [ ] **Step 1: Write the failing test**

_server/src/code-connect/url.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { parseFigmaUrl } from "./url.js";

describe("parseFigmaUrl", () => {
  test("reads the file key and converts the hyphenated node id", () => {
    expect(
      parseFigmaUrl("https://www.figma.com/design/AbC123/Design-System?node-id=1-2&t=xyz")
    ).toEqual({ fileKey: "AbC123", nodeId: "1:2" });
  });

  test("accepts the legacy /file/ path", () => {
    expect(parseFigmaUrl("https://figma.com/file/AbC123/DS?node-id=10-20")?.nodeId).toBe("10:20");
  });

  test("accepts a node id that already uses a colon", () => {
    expect(parseFigmaUrl("https://figma.com/design/AbC123/DS?node-id=1:2")?.nodeId).toBe("1:2");
  });

  test("returns null without a node id, because a file-only URL maps nothing", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/DS")).toBeNull();
  });

  test("returns null for a non-Figma URL", () => {
    expect(parseFigmaUrl("https://example.com/design/AbC123?node-id=1-2")).toBeNull();
  });

  test("returns null for something that is not a URL at all", () => {
    expect(parseFigmaUrl("Button")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/code-connect/url.test.ts`
Expected: FAIL — `Cannot find module './url.js'`

- [ ] **Step 3: Write the implementation**

_server/src/code-connect/url.ts — create_

```ts
export interface FigmaTarget {
  fileKey: string;
  /** Colon form, e.g. `1:2` — the form every other tool in this server uses. */
  nodeId: string;
}

/**
 * Extracts the file key and node id from a Figma design URL.
 *
 * Figma writes node ids hyphenated in URLs (`node-id=1-2`) and colon-separated
 * everywhere else (`1:2`). Normalising here is what stops a lookup from
 * silently never matching.
 * @param url - A Figma design or file URL.
 * @returns The target, or null when the URL is not a Figma node URL.
 */
export const parseFigmaUrl = (url: string): FigmaTarget | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!/(^|\.)figma\.com$/.test(parsed.hostname)) return null;

  const match = parsed.pathname.match(/^\/(?:design|file|board|slides)\/([A-Za-z0-9]+)/);
  if (!match) return null;

  const rawNodeId = parsed.searchParams.get("node-id");
  if (!rawNodeId) return null;

  const nodeId = rawNodeId.replace(/-/g, ":");
  if (!/^\d+:\d+$/.test(nodeId)) return null;

  return { fileKey: match[1], nodeId };
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/code-connect/url.test.ts`
Expected: PASS — 6 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add server/src/code-connect/url.ts server/src/code-connect/url.test.ts
git commit -m "feat(server): parse Figma node URLs into file key and node id"
```

---

### Task 2: Discover Code Connect files [R28]

Walking a workspace means walking into `node_modules` unless you say otherwise, and following a symlink out of the workspace unless you check. Both are handled here so no later task has to think about it.

**Files:**

- Create: `server/src/code-connect/discover.ts`
- Create: `server/src/code-connect/discover.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `discoverCodeConnectFiles(root): Promise<string[]>` returning workspace-relative POSIX paths, and `IGNORED_DIRECTORIES`. Tasks 4, 6 and 7 import them from `./discover.js`.

- [ ] **Step 1: Write the failing test**

_server/src/code-connect/discover.test.ts — create_

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverCodeConnectFiles } from "./discover.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cc-"));
  await mkdir(path.join(root, "src", "ui"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, "src", "ui", "Button.figma.tsx"), "");
  await writeFile(path.join(root, "src", "ui", "Card.figma.ts"), "");
  await writeFile(path.join(root, "src", "ui", "Button.tsx"), "");
  await writeFile(path.join(root, "node_modules", "pkg", "Thing.figma.ts"), "");
  await writeFile(path.join(root, ".git", "Hook.figma.ts"), "");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("discoverCodeConnectFiles", () => {
  test("finds every Code Connect file under the root", async () => {
    const found = await discoverCodeConnectFiles(root);
    expect(found).toContain("src/ui/Button.figma.tsx");
    expect(found).toContain("src/ui/Card.figma.ts");
  });

  test("ignores ordinary sources", async () => {
    expect(await discoverCodeConnectFiles(root)).not.toContain("src/ui/Button.tsx");
  });

  test("does not descend into node_modules or .git", async () => {
    const found = await discoverCodeConnectFiles(root);
    expect(found.some((file) => file.includes("node_modules"))).toBe(false);
    expect(found.some((file) => file.includes(".git"))).toBe(false);
  });

  test("returns POSIX paths on every platform", async () => {
    const found = await discoverCodeConnectFiles(root);
    expect(found.every((file) => !file.includes("\\"))).toBe(true);
  });

  test("returns an empty list for a directory with none", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "cc-empty-"));
    expect(await discoverCodeConnectFiles(empty)).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/code-connect/discover.test.ts`
Expected: FAIL — `Cannot find module './discover.js'`

- [ ] **Step 3: Write the implementation**

_server/src/code-connect/discover.ts — create_

```ts
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Directories never worth walking. `node_modules` alone can hold hundreds of
 * thousands of files, and a package's own Code Connect fixtures are not the
 * user's mappings.
 */
export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
]);

const CODE_CONNECT = /\.figma\.(ts|tsx|js|jsx)$/;

/**
 * Finds every Code Connect file under `root`.
 *
 * Symlinks that point outside `root` are skipped: discovery must not become a
 * way to read files outside the workspace.
 * @param root - Directory to search, normally the MCP server's working directory.
 * @returns Workspace-relative POSIX paths, sorted.
 */
export const discoverCodeConnectFiles = async (root: string): Promise<string[]> => {
  const base = await realpath(root);
  const found: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(full);
        continue;
      }

      if (!CODE_CONNECT.test(entry.name)) continue;

      let resolved: string;
      try {
        resolved = await realpath(full);
      } catch {
        continue;
      }
      if (resolved !== base && !resolved.startsWith(base + path.sep)) continue;

      found.push(path.relative(base, full).split(path.sep).join("/"));
    }
  };

  await walk(base);
  return found.sort();
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/code-connect/discover.test.ts`
Expected: PASS — 5 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add server/src/code-connect/discover.ts server/src/code-connect/discover.test.ts
git commit -m "feat(server): discover Code Connect files inside the workspace"
```

---

### Task 3: Parse `figma.connect(...)` calls [R29]

A TypeScript parser would be the obvious tool and is the wrong one here: it is a heavy dependency for a job with three known shapes. This scanner walks the source respecting strings and comments, takes the balanced argument list, and reports anything it cannot read rather than guessing.

**Files:**

- Create: `server/src/code-connect/parse.ts`
- Create: `server/src/code-connect/parse.test.ts`

**Interfaces:**

- Consumes: `parseFigmaUrl`, `FigmaTarget` from `./url.js`.
- Produces: `parseCodeConnect(source, sourcePath): ParseResult`, plus the `Mapping` and `ParseResult` types. Tasks 4, 6, 7 and 8 import them from `./parse.js`.

- [ ] **Step 1: Write the failing test**

_server/src/code-connect/parse.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { parseCodeConnect } from "./parse.js";

const source = `
import figma from "@figma/code-connect";
import { Button } from "./Button";

// figma.connect(Ignored, "https://figma.com/design/K/D?node-id=9-9")
figma.connect(Button, "https://www.figma.com/design/AbC/DS?node-id=1-2", {
  props: {
    label: figma.string("Label"),
    variant: figma.enum("Variant", { Primary: "primary" }),
  },
  example: (props) => <Button {...props} />,
});

figma.connect(Icons.Search, "https://www.figma.com/design/AbC/DS?node-id=3-4");
`;

describe("parseCodeConnect", () => {
  test("finds every call", () => {
    expect(parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings).toHaveLength(2);
  });

  test("records the component, the target and the source path", () => {
    const [first] = parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings;
    expect(first).toMatchObject({
      component: "Button",
      fileKey: "AbC",
      nodeId: "1:2",
      source: "src/ui/Button.figma.tsx",
    });
  });

  test("lists the declared props", () => {
    const [first] = parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings;
    expect(first.props).toEqual(["label", "variant"]);
  });

  test("handles a dotted component name and a missing options object", () => {
    const [, second] = parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings;
    expect(second.component).toBe("Icons.Search");
    expect(second.props).toEqual([]);
  });

  test("ignores calls inside comments", () => {
    const components = parseCodeConnect(source, "x.figma.ts").mappings.map((m) => m.component);
    expect(components).not.toContain("Ignored");
  });

  test("reports a call it cannot read instead of dropping it", () => {
    const result = parseCodeConnect("figma.connect(Button, someUrlVariable);", "bad.figma.ts");
    expect(result.mappings).toHaveLength(0);
    expect(result.errors[0]).toContain("bad.figma.ts");
  });

  test("reports an unterminated call", () => {
    const result = parseCodeConnect(
      'figma.connect(Button, "https://figma.com/design/K/D?node-id=1-2"',
      "trunc.figma.ts"
    );
    expect(result.errors[0]).toContain("trunc.figma.ts");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/code-connect/parse.test.ts`
Expected: FAIL — `Cannot find module './parse.js'`

- [ ] **Step 3: Write the implementation**

_server/src/code-connect/parse.ts — create_

```ts
import { parseFigmaUrl } from "./url.js";

export interface Mapping {
  /** The code component's identifier as written, e.g. `Button` or `Icons.Search`. */
  component: string;
  fileKey: string;
  nodeId: string;
  /** Workspace-relative path of the file declaring the mapping. */
  source: string;
  /** Prop names declared in the options object, in source order. */
  props: string[];
}

export interface ParseResult {
  mappings: Mapping[];
  /** One message per call this scanner could not read. Never silent. */
  errors: string[];
}

const OPENERS = "([{";
const CLOSERS = ")]}";

/**
 * Blanks out string and comment contents so a scan sees only code structure.
 * Positions are preserved, so indices into the mask are valid in the original.
 */
const maskLiterals = (source: string): string => {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) ((out[i] = source[i] === "\n" ? "\n" : " "), i++);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (source[i] === quote) break;
        out[i] = source[i] === "\n" ? "\n" : " ";
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
};

/** Returns the index of the bracket matching the one at `open`, or -1. */
const matchBracket = (mask: string, open: number): number => {
  const stack: string[] = [];
  for (let i = open; i < mask.length; i++) {
    const ch = mask[i];
    if (OPENERS.includes(ch)) stack.push(ch);
    else if (CLOSERS.includes(ch)) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
};

/** Splits an argument list on commas that sit at depth zero. */
const splitArgs = (mask: string, from: number, to: number): Array<[number, number]> => {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const ch = mask[i];
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, to]);
  return spans;
};

/** Reads the prop names declared in `props: { ... }` inside the options object. */
const readProps = (source: string, mask: string, from: number, to: number): string[] => {
  const key = mask.slice(from, to).search(/\bprops\s*:/);
  if (key === -1) return [];
  const brace = mask.indexOf("{", from + key);
  if (brace === -1 || brace >= to) return [];
  const close = matchBracket(mask, brace);
  if (close === -1) return [];

  const names: string[] = [];
  let depth = 0;
  let atKey = true;
  let buffer = "";
  for (let i = brace + 1; i < close; i++) {
    const ch = mask[i];
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth--;
    else if (depth === 0 && ch === ":") {
      if (atKey) {
        const name = buffer.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
        atKey = false;
      }
      buffer = "";
      continue;
    } else if (depth === 0 && ch === ",") {
      atKey = true;
      buffer = "";
      continue;
    }
    if (depth === 0 && atKey) buffer += source[i];
  }
  return names;
};

/**
 * Extracts every `figma.connect(...)` mapping from one Code Connect file.
 *
 * A call the scanner cannot read is reported in `errors` with its file and
 * line, never dropped — silence would make an agent believe a mapped component
 * is unmapped and generate a fresh one.
 * @param source - The file's contents.
 * @param sourcePath - Workspace-relative path, used in results and errors.
 */
export const parseCodeConnect = (source: string, sourcePath: string): ParseResult => {
  const mask = maskLiterals(source);
  const mappings: Mapping[] = [];
  const errors: string[] = [];

  const CALL = /\bfigma\s*\.\s*connect\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = CALL.exec(mask)) !== null) {
    const open = match.index + match[0].length - 1;
    const line = source.slice(0, match.index).split("\n").length;
    const close = matchBracket(mask, open);
    if (close === -1) {
      errors.push(`${sourcePath}:${line} — unterminated figma.connect(...) call`);
      continue;
    }

    const args = splitArgs(mask, open + 1, close);
    const component = source.slice(args[0]?.[0] ?? 0, args[0]?.[1] ?? 0).trim();
    const urlSpan = args[1];
    const urlMatch = urlSpan
      ? source.slice(urlSpan[0], urlSpan[1]).match(/["'`]([^"'`]+)["'`]/)
      : null;

    if (!component || !urlMatch) {
      errors.push(
        `${sourcePath}:${line} — could not read the component and URL arguments; ` +
          `expected figma.connect(Component, "https://figma.com/design/...?node-id=1-2", { ... })`
      );
      continue;
    }

    const target = parseFigmaUrl(urlMatch[1]);
    if (!target) {
      errors.push(`${sourcePath}:${line} — "${urlMatch[1]}" is not a Figma node URL`);
      continue;
    }

    mappings.push({
      component,
      fileKey: target.fileKey,
      nodeId: target.nodeId,
      source: sourcePath,
      props: args[2] ? readProps(source, mask, args[2][0], args[2][1]) : [],
    });

    CALL.lastIndex = close;
  }

  return { mappings, errors };
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/code-connect/parse.test.ts`
Expected: PASS — 7 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add server/src/code-connect/parse.ts server/src/code-connect/parse.test.ts
git commit -m "feat(server): parse figma.connect calls without a TypeScript dependency"
```

---

### Task 4: The index and `get_code_connect_map` [R30]

Discovery plus parsing plus a lookup. The index is rebuilt per call rather than cached — mappings are files an agent may have just written, and a stale cache here is worse than a few milliseconds of directory walking.

**Files:**

- Create: `server/src/code-connect/index.ts`
- Create: `server/src/code-connect/index.test.ts`
- Modify: `server/src/schema.ts` — add `get_code_connect_map` to `toolInputSchemas` and `rpcToArgs`
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: `discoverCodeConnectFiles` from `./discover.js`; `parseCodeConnect`, `Mapping` from `./parse.js`.
- Produces: `buildCodeConnectIndex(root): Promise<CodeConnectIndex>` and the `CodeConnectIndex` type, whose `lookup(nodeId, fileKey?)` returns `Mapping | undefined`. Tasks 6, 7 and 8 import them from `./index.js`.

- [ ] **Step 1: Write the failing test**

_server/src/code-connect/index.test.ts — create_

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCodeConnectIndex } from "./index.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cc-index-"));
  await mkdir(path.join(root, "ui"), { recursive: true });
  await writeFile(
    path.join(root, "ui", "Button.figma.tsx"),
    'figma.connect(Button, "https://figma.com/design/AbC/DS?node-id=1-2", { props: { label: figma.string("Label") } });'
  );
  await writeFile(
    path.join(root, "ui", "Card.figma.tsx"),
    'figma.connect(Card, "https://figma.com/design/Zed/Other?node-id=1-2");'
  );
  await writeFile(path.join(root, "ui", "Broken.figma.ts"), "figma.connect(Broken, notAUrl);");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("buildCodeConnectIndex", () => {
  test("collects every mapping it could read", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.mappings).toHaveLength(2);
  });

  test("reports the file it could not read", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.errors[0]).toContain("Broken.figma.ts");
  });

  test("disambiguates the same node id across files by file key", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.lookup("1:2", "AbC")?.component).toBe("Button");
    expect(index.lookup("1:2", "Zed")?.component).toBe("Card");
  });

  test("falls back to a unique node-id match when no file key is given", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.lookup("9:9")).toBeUndefined();
  });

  test("counts the files it scanned", async () => {
    const index = await buildCodeConnectIndex(root);
    expect(index.filesScanned).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/code-connect/index.test.ts`
Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Write the index**

_server/src/code-connect/index.ts — create_

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverCodeConnectFiles } from "./discover.js";
import { parseCodeConnect, type Mapping } from "./parse.js";

export interface CodeConnectIndex {
  mappings: Mapping[];
  errors: string[];
  filesScanned: number;
  /**
   * Finds the mapping for a node.
   * @param nodeId - Colon-form node id.
   * @param fileKey - Preferred when several files map the same node id.
   */
  lookup: (nodeId: string, fileKey?: string) => Mapping | undefined;
}

/**
 * Builds the Code Connect index for a workspace.
 *
 * Rebuilt on every call rather than cached: an agent may have written a mapping
 * seconds ago, and a stale index is worse than a directory walk.
 * @param root - The MCP server's working directory.
 */
export const buildCodeConnectIndex = async (root: string): Promise<CodeConnectIndex> => {
  const files = await discoverCodeConnectFiles(root);
  const mappings: Mapping[] = [];
  const errors: string[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = await readFile(path.join(root, file), "utf8");
    } catch (err) {
      errors.push(
        `${file} — could not be read: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const result = parseCodeConnect(source, file);
    mappings.push(...result.mappings);
    errors.push(...result.errors);
  }

  const lookup = (nodeId: string, fileKey?: string): Mapping | undefined => {
    const candidates = mappings.filter((mapping) => mapping.nodeId === nodeId);
    if (candidates.length === 0) return undefined;
    if (fileKey) {
      const exact = candidates.find((mapping) => mapping.fileKey === fileKey);
      if (exact) return exact;
    }
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  return { mappings, errors, filesScanned: files.length, lookup };
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/code-connect/index.test.ts`
Expected: PASS — 5 pass, 0 fail

- [ ] **Step 5: Add the tool schema and RPC mapper**

In `server/src/schema.ts`, add to `toolInputSchemas`:

```ts
  get_code_connect_map: z.object({
    nodeIds: z
      .array(createFigmaNodeIdSchema())
      .optional()
      .describe("Restrict the result to these nodes. Omit to return every mapping."),
    fileKey: fileKeyField,
  }),
```

And to `rpcToArgs`:

```ts
  get_code_connect_map: (nodeIds, params) => ({ nodeIds, ...params }),
```

- [ ] **Step 6: Register the tool**

In `server/src/tools.ts`, inside `registerTools`:

```ts
server.tool(
  "get_code_connect_map",
  "Map Figma nodes to the components that implement them, read from the *.figma.ts files in this workspace. Call it before writing code from a design: a mapped node should be implemented with the mapped component, not a new one. Mappings are local files under version control, not Figma cloud records.",
  toolInputSchemas.get_code_connect_map.shape,
  async ({ nodeIds, fileKey }): Promise<ToolResult> => {
    try {
      const index = await buildCodeConnectIndex(process.cwd());
      const mappings = nodeIds?.length
        ? nodeIds
            .map((id) => index.lookup(id, fileKey))
            .filter((m): m is Mapping => m !== undefined)
        : index.mappings;
      return {
        content: [
          textBlock(
            JSON.stringify(
              { mappings, filesScanned: index.filesScanned, errors: index.errors },
              null,
              2
            )
          ),
        ],
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

- [ ] **Step 7: Verify the build and the suite**

Run: `cd server && bun run build && bun run test`
Expected: PASS — no `tsc` errors, every test green

- [ ] **Step 8: Commit**

```bash
git add server/src/code-connect/index.ts server/src/code-connect/index.test.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat(server): add get_code_connect_map backed by workspace files"
```

---

### Task 5: `get_context_for_code_connect` [R33]

To author a mapping you need the component's props and variant axes. Phase 2 already put `componentPropertyDefinitions` on serialized components; this exposes them under a name that says what they are for.

**Files:**

- Modify: `plugin/src/main/code.ts` — new `get_component_context` request type and case
- Modify: `server/src/schema.ts` — `get_context_for_code_connect` schema and `rpcToArgs` entry
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: phase 2's `serializeComponentIdentity` output via the serializer; `buildCodeConnectIndex` from `./code-connect/index.js`.
- Produces: a bridge request `get_component_context` with `params: { nodeId }` returning `{ id, name, key, type, propertyDefinitions, variantAxes, description }`, and the MCP tool that wraps it.

- [ ] **Step 1: Add the plugin request type and case**

Add `"get_component_context"` to the `RequestType` union in `plugin/src/main/code.ts`, then add the case before `default:`. The owner narrowing from phase 2 is reused rather than re-derived — reading `componentPropertyDefinitions` off a variant throws.

```ts
      case "get_component_context": {
        const nodeId = request.params?.nodeId;
        if (typeof nodeId !== "string") {
          throw new Error("get_component_context requires a `nodeId` string parameter.");
        }
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found in this file.`);

        const owner = componentPropertyOwner(node as never);
        if (!owner) {
          throw new Error(
            `Node ${nodeId} is a ${node.type}, not a COMPONENT or COMPONENT_SET. ` +
              `Code Connect maps components; select the main component, not an instance.`
          );
        }

        const definitions =
          (owner as { componentPropertyDefinitions?: Record<string, unknown> })
            .componentPropertyDefinitions ?? {};
        const variantAxes = Object.entries(definitions)
          .filter(([, definition]) => (definition as { type?: string }).type === "VARIANT")
          .map(([name, definition]) => ({
            name,
            options: (definition as { variantOptions?: string[] }).variantOptions ?? [],
          }));

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            id: node.id,
            name: node.name,
            key: (node as { key?: string }).key,
            type: node.type,
            description: (node as { description?: string }).description || undefined,
            propertyDefinitions: definitions,
            variantAxes,
          },
        };
      }
```

- [ ] **Step 2: Add the schema and mapper**

In `server/src/schema.ts`:

```ts
  get_context_for_code_connect: z.object({
    nodeId: createFigmaNodeIdSchema().describe(
      "The COMPONENT or COMPONENT_SET to describe. Pass the main component, not an instance."
    ),
    fileKey: fileKeyField,
  }),
```

```ts
  get_context_for_code_connect: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
```

- [ ] **Step 3: Register the tool**

```ts
server.tool(
  "get_context_for_code_connect",
  "Describe a Figma component's properties and variant axes so a Code Connect mapping can be authored accurately. Returns the property definitions, the variant options per axis, the component key, and any description the designer wrote.",
  toolInputSchemas.get_context_for_code_connect.shape,
  async ({ nodeId, fileKey }): Promise<ToolResult> => {
    return renderResponse(() =>
      node.sendWithParams("get_component_context", [nodeId], undefined, fileKey)
    );
  }
);
```

- [ ] **Step 4: Verify both halves build**

Run: `cd server && bun run build && cd ../plugin && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — no errors from either

- [ ] **Step 5: Prove the error path by hand**

With the plugin running in a design file, call `get_context_for_code_connect` on an **instance** rather than its main component.

Expected: an error explaining that Code Connect maps components and telling you to select the main component — not a raw type error.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/code.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat: add get_context_for_code_connect"
```

---

### Task 6: `get_code_connect_suggestions` [R32]

Suggestions are a ranking problem, and the ranking has to be legible: an agent should be able to see _why_ a candidate was proposed and reject it. This tool never writes.

**Files:**

- Create: `server/src/code-connect/suggest.ts`
- Create: `server/src/code-connect/suggest.test.ts`
- Modify: `server/src/schema.ts` — schema and `rpcToArgs` entry
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: `Mapping` from `./parse.js`; `discoverCodeConnectFiles`, `IGNORED_DIRECTORIES` from `./discover.js`.
- Produces: `scoreCandidates(figmaName, exports): Suggestion[]` and `findExportedComponents(root): Promise<ExportedComponent[]>`. Task 8 does not use them; only the tool does.

- [ ] **Step 1: Write the failing test**

Only the scorer is unit-tested — it holds the judgement. The export scan is directory I/O, proven in step 6.

_server/src/code-connect/suggest.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { scoreCandidates } from "./suggest.js";

const exports = [
  { name: "Button", source: "src/ui/Button.tsx" },
  { name: "ButtonGroup", source: "src/ui/ButtonGroup.tsx" },
  { name: "Card", source: "src/ui/Card.tsx" },
  { name: "IconButton", source: "src/ui/IconButton.tsx" },
];

describe("scoreCandidates", () => {
  test("ranks an exact name match first", () => {
    expect(scoreCandidates("Button", exports)[0].component).toBe("Button");
  });

  test("matches a Figma variant path against its component name", () => {
    expect(scoreCandidates("Button/Primary", exports)[0].component).toBe("Button");
  });

  test("is case and separator insensitive", () => {
    expect(scoreCandidates("icon button", exports)[0].component).toBe("IconButton");
  });

  test("explains why each candidate was proposed", () => {
    expect(scoreCandidates("Button", exports)[0].evidence).toMatch(/exact/i);
  });

  test("returns nothing rather than a bad guess", () => {
    expect(scoreCandidates("Zzzz Widget", exports)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/code-connect/suggest.test.ts`
Expected: FAIL — `Cannot find module './suggest.js'`

- [ ] **Step 3: Write the implementation**

_server/src/code-connect/suggest.ts — create_

```ts
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { IGNORED_DIRECTORIES } from "./discover.js";

export interface ExportedComponent {
  name: string;
  /** Workspace-relative POSIX path. */
  source: string;
}

export interface Suggestion {
  component: string;
  source: string;
  /** 0-1; higher is a stronger match. */
  score: number;
  /** Why this candidate was proposed, so it can be rejected on sight. */
  evidence: string;
}

/** Normalises `Button/Primary`, `icon button` and `IconButton` to one form. */
const normalise = (name: string): string =>
  name
    .split("/")[0]
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/**
 * Ranks exported components against a Figma component name.
 * @param figmaName - The Figma component or component-set name.
 * @param exports - Components exported anywhere in the workspace.
 * @returns Candidates above the confidence floor, strongest first. Possibly empty.
 */
export const scoreCandidates = (figmaName: string, exports: ExportedComponent[]): Suggestion[] => {
  const target = normalise(figmaName);
  if (target === "") return [];

  const scored = exports.flatMap((exported): Suggestion[] => {
    const candidate = normalise(exported.name);
    if (candidate === target) {
      return [
        {
          component: exported.name,
          source: exported.source,
          score: 1,
          evidence: `exact name match for "${figmaName}"`,
        },
      ];
    }
    if (candidate.startsWith(target) || target.startsWith(candidate)) {
      const ratio =
        Math.min(candidate.length, target.length) / Math.max(candidate.length, target.length);
      return [
        {
          component: exported.name,
          source: exported.source,
          score: 0.5 + ratio * 0.4,
          evidence: `name prefix overlap with "${figmaName}"`,
        },
      ];
    }
    return [];
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
};

const SOURCE_FILE = /\.(ts|tsx|js|jsx)$/;
const EXPORTED = /export\s+(?:default\s+)?(?:const|function|class)\s+([A-Z][\w$]*)/g;

/**
 * Scans the workspace for exported identifiers that look like components —
 * capitalised, exported, in a source file.
 * @param root - The MCP server's working directory.
 */
export const findExportedComponents = async (root: string): Promise<ExportedComponent[]> => {
  const base = await realpath(root);
  const found: ExportedComponent[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!SOURCE_FILE.test(entry.name) || /\.figma\.|\.test\./.test(entry.name)) continue;

      let source: string;
      try {
        source = await readFile(full, "utf8");
      } catch {
        continue;
      }
      const relative = path.relative(base, full).split(path.sep).join("/");
      for (const match of source.matchAll(EXPORTED)) {
        found.push({ name: match[1], source: relative });
      }
    }
  };

  await walk(base);
  return found;
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/code-connect/suggest.test.ts`
Expected: PASS — 5 pass, 0 fail

- [ ] **Step 5: Add the schema, mapper and tool**

In `server/src/schema.ts`:

```ts
  get_code_connect_suggestions: z.object({
    nodeIds: z
      .array(createFigmaNodeIdSchema())
      .min(1)
      .describe("Component or component-set nodes to propose mappings for."),
    fileKey: fileKeyField,
  }),
```

```ts
  get_code_connect_suggestions: (nodeIds, params) => ({ nodeIds, ...params }),
```

In `server/src/tools.ts`, register a handler that, for each node id, fetches the node's name via `get_node`, skips ids the index already maps, and returns `scoreCandidates(name, await findExportedComponents(process.cwd()))`. Scan the workspace once, outside the loop.

- [ ] **Step 6: Prove it end to end**

With the plugin open in a design file that has a component matching one of your codebase components, call `get_code_connect_suggestions` on that component's node id.

Expected: the matching component ranked first with `evidence` reading `exact name match`, and no file written anywhere.

- [ ] **Step 7: Commit**

```bash
git add server/src/code-connect/suggest.ts server/src/code-connect/suggest.test.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat(server): suggest Code Connect mappings from workspace exports"
```

---

### Task 7: `add_code_connect_map` [R31]

This is the only tool in the phase that writes. It writes a **file**, not a cloud record, and the tool description has to say so — an agent that thinks it published to Figma will not commit the file.

**Files:**

- Create: `server/src/code-connect/write.ts`
- Create: `server/src/code-connect/write.test.ts`
- Modify: `server/src/schema.ts` — schema and `rpcToArgs` entry
- Modify: `server/src/tools.ts` — register the tool

**Interfaces:**

- Consumes: `Mapping` from `./parse.js`; `buildCodeConnectIndex` from `./index.js`.
- Produces: `renderMappingFile(input): string` and `writeMapping(root, input): Promise<{ file: string; created: boolean }>`.

- [ ] **Step 1: Write the failing test**

_server/src/code-connect/write.test.ts — create_

```ts
import { describe, expect, test } from "bun:test";
import { renderMappingFile } from "./write.js";

const rendered = renderMappingFile({
  component: "Button",
  importPath: "../ui/Button",
  url: "https://www.figma.com/design/AbC/DS?node-id=1-2",
  props: ["label", "variant"],
});

describe("renderMappingFile", () => {
  test("imports the Code Connect helper and the component", () => {
    expect(rendered).toContain('import figma from "@figma/code-connect";');
    expect(rendered).toContain('import { Button } from "../ui/Button";');
  });

  test("connects the component to the node URL", () => {
    expect(rendered).toContain(
      'figma.connect(Button, "https://www.figma.com/design/AbC/DS?node-id=1-2"'
    );
  });

  test("stubs each declared prop so the author fills it in", () => {
    expect(rendered).toContain('label: figma.string("label")');
    expect(rendered).toContain('variant: figma.string("variant")');
  });

  test("omits the props block entirely when there are none", () => {
    const bare = renderMappingFile({
      component: "Divider",
      importPath: "./Divider",
      url: "https://www.figma.com/design/AbC/DS?node-id=3-4",
      props: [],
    });
    expect(bare).not.toContain("props:");
  });

  test("is valid to re-parse", async () => {
    const { parseCodeConnect } = await import("./parse.js");
    expect(parseCodeConnect(rendered, "Button.figma.tsx").mappings[0]).toMatchObject({
      component: "Button",
      nodeId: "1:2",
      props: ["label", "variant"],
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && bun test src/code-connect/write.test.ts`
Expected: FAIL — `Cannot find module './write.js'`

- [ ] **Step 3: Write the implementation**

_server/src/code-connect/write.ts — create_

```ts
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export interface MappingInput {
  component: string;
  /** Import specifier for the component, relative to the mapping file. */
  importPath: string;
  url: string;
  props: string[];
}

/**
 * Renders a Code Connect file for one mapping.
 *
 * Props are stubbed as `figma.string(...)` rather than guessed: the author
 * knows whether a prop is a boolean, an enum or a nested instance, and a wrong
 * guess is harder to spot than an obvious placeholder.
 */
export const renderMappingFile = (input: MappingInput): string => {
  const props =
    input.props.length > 0
      ? `  props: {\n${input.props.map((prop) => `    ${prop}: figma.string("${prop}"),`).join("\n")}\n  },\n`
      : "";

  return `import figma from "@figma/code-connect";
import { ${input.component} } from "${input.importPath}";

figma.connect(${input.component}, "${input.url}", {
${props}  example: (props) => <${input.component} {...props} />,
});
`;
};

/**
 * Writes a mapping file inside the workspace.
 *
 * @param root - The MCP server's working directory.
 * @param input - The mapping, plus the target path relative to `root`.
 * @returns The workspace-relative path written, and whether the file is new.
 * @throws When the target resolves outside the working directory, or when the
 * file already maps this component (appending a duplicate would create two
 * mappings for one node).
 */
export const writeMapping = async (
  root: string,
  input: MappingInput & { file: string }
): Promise<{ file: string; created: boolean }> => {
  const base = await realpath(root);
  const target = path.resolve(base, input.file);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(
      `file "${input.file}" resolves outside the MCP server working directory (${base}). ` +
        `Code Connect mappings must live in the workspace so they can be committed.`
    );
  }

  await mkdir(path.dirname(target), { recursive: true });

  let existing: string | null = null;
  try {
    existing = await readFile(target, "utf8");
  } catch {
    existing = null;
  }

  if (existing !== null) {
    if (existing.includes(input.url)) {
      throw new Error(
        `${input.file} already maps ${input.url}. Edit the existing figma.connect call rather than adding a second one.`
      );
    }
    const block = renderMappingFile(input)
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n")
      .trim();
    await writeFile(target, `${existing.trimEnd()}\n\n${block}\n`);
    return { file: input.file, created: false };
  }

  await writeFile(target, renderMappingFile(input));
  return { file: input.file, created: true };
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd server && bun test src/code-connect/write.test.ts`
Expected: PASS — 5 pass, 0 fail

- [ ] **Step 5: Add the schema, mapper and tool**

In `server/src/schema.ts`:

```ts
  add_code_connect_map: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The Figma component node to map."),
    component: z.string().min(1).describe("The code component's exported name, e.g. `Button`."),
    importPath: z
      .string()
      .min(1)
      .describe("Import specifier for the component, relative to the mapping file."),
    file: z
      .string()
      .min(1)
      .describe(
        "Mapping file path relative to the MCP server working directory, e.g. `src/ui/Button.figma.tsx`."
      ),
    props: z.array(z.string()).optional().describe("Prop names to stub in the mapping."),
    fileKey: fileKeyField,
  }),
```

```ts
  add_code_connect_map: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
```

Register the tool with a description that leads with the divergence:

```ts
server.tool(
  "add_code_connect_map",
  "Write a Code Connect mapping between a Figma node and a component in this workspace. This writes a local *.figma.tsx FILE — it does not publish anything to Figma. Commit the file to share the mapping. Props are stubbed as figma.string(...) for you to refine; the file must live inside the MCP server working directory.",
  toolInputSchemas.add_code_connect_map.shape,
  async ({ nodeId, component, importPath, file, props, fileKey }): Promise<ToolResult> => {
    try {
      const url = `https://www.figma.com/design/${fileKey ?? "FILE_KEY"}/?node-id=${nodeId.replace(":", "-")}`;
      const result = await writeMapping(process.cwd(), {
        component,
        importPath,
        url,
        props: props ?? [],
        file,
      });
      return { content: [textBlock(JSON.stringify(result))] };
    } catch (err) {
      return {
        content: [textBlock(err instanceof Error ? err.message : String(err))],
        isError: true,
      };
    }
  }
);
```

- [ ] **Step 6: Prove containment and duplicate refusal by hand**

Call `add_code_connect_map` twice with the same `nodeId` and `file`, then once with `file: "../escape.figma.ts"`.

Expected: the first writes; the second refuses, naming the existing mapping; the third refuses, naming the working directory. No file appears outside the workspace.

- [ ] **Step 7: Commit**

```bash
git add server/src/code-connect/write.ts server/src/code-connect/write.test.ts server/src/schema.ts server/src/tools.ts
git commit -m "feat(server): write Code Connect mappings as workspace files"
```

---

### Task 8: Surface mappings in design context, and document [R34, R35]

A mapping nobody reads changes nothing. This wires the index into `get_design_context` so the snippet appears exactly where an agent is deciding what to write — and documents the one place we deliberately diverge from the official server.

**Files:**

- Modify: `server/src/tools.ts` — `composeDesignContext` and the `get_design_context` handler
- Modify: `README.md` — tool table and Editing Notes
- Create: `docs/code-connect.md`

**Interfaces:**

- Consumes: `buildCodeConnectIndex` from `./code-connect/index.js`; `composeDesignContext` from phase 3.
- Produces: documentation only.

- [ ] **Step 1: Extend the composer**

Phase 3's `composeDesignContext` takes a `DesignContextInput`. Add `mappings: Mapping[]` to it and emit a section **before** the reference code, because it changes what the agent should write:

```ts
if (input.mappings.length > 0) {
  const rows = input.mappings
    .map(
      (mapping) =>
        `- node \`${mapping.nodeId}\` → \`${mapping.component}\` from \`${mapping.source}\``
    )
    .join("\n");
  sections.unshift(
    `## Code Connect mappings\n\nThese nodes already have components. Use them — do not generate equivalents.\n\n${rows}`
  );
}
```

- [ ] **Step 2: Feed the index in**

In the `get_design_context` handler, build the index and collect the mappings for every node id in the serialized tree:

```ts
const index = await buildCodeConnectIndex(process.cwd());
const mapped: Mapping[] = [];
const collect = (current: SerializedNode): void => {
  const mapping = index.lookup(current.id, fileKey);
  if (mapping) mapped.push(mapping);
  for (const child of current.children ?? []) collect(child);
};
collect(tree);
```

Pass `mappings: mapped` into `composeDesignContext`.

- [ ] **Step 3: Update the phase 3 composer test**

Phase 3's `design-context.test.ts` constructs `DesignContextInput` without `mappings`. Add `mappings: []` to each case, and add one asserting the new section leads:

```ts
test("puts Code Connect mappings ahead of the reference code", () => {
  const [first] = composeDesignContext({
    tree,
    format: "react",
    assets: [],
    mappings: [
      {
        component: "Card",
        fileKey: "AbC",
        nodeId: "1:1",
        source: "src/ui/Card.figma.tsx",
        props: [],
      },
    ],
  });
  const text = (first as { text: string }).text;
  expect(text.indexOf("Code Connect mappings")).toBeLessThan(text.indexOf("Reference code"));
});
```

- [ ] **Step 4: Run the whole suite and build**

Run: `cd server && bun run test && bun run build`
Expected: PASS — every test green, no `tsc` errors

- [ ] **Step 5: Prove it end to end**

Map a component with `add_code_connect_map`, then call `get_design_context` on a frame containing an instance of it.

Expected: the response opens with a Code Connect mappings section naming your component and its source file, above the reference code.

- [ ] **Step 6: Write the guide**

Create `docs/code-connect.md` covering: where mappings live and that they are committed files; the four tools and what each does; the discovery rules (`**/*.figma.{ts,tsx,js,jsx}`, ignored directories, containment); the parser's supported shapes and what it reports as unreadable; why there is no `send_code_connect_mappings` — the bridge's equivalent is `git commit`, which makes the mapping reviewable in a way a cloud record is not; and the hint priority from the spec's R25.

- [ ] **Step 7: Update the README**

Add four rows to the tool table:

```markdown
| `get_code_connect_map` | Map Figma nodes to workspace components, read from local `*.figma.ts` files ([guide](docs/code-connect.md)) |
| `get_context_for_code_connect` | A component's properties and variant axes, for authoring a mapping |
| `get_code_connect_suggestions` | Propose mappings by matching Figma component names against workspace exports |
| `add_code_connect_map` | Write a Code Connect mapping file into the workspace |
```

And append to Editing Notes:

```markdown
- Code Connect on the bridge is entirely local: mappings are read from and written to `*.figma.ts` files in your repository, never Figma's cloud. There is no `send_code_connect_mappings` equivalent — committing the file is the publish step, which also makes the mapping reviewable.
```

- [ ] **Step 8: Format and run everything**

```bash
bun run format
cd server && bun run test && bun run build
cd ../plugin && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

Expected: PASS — Prettier reports no remaining changes on a second run, both suites green, both builds clean

- [ ] **Step 9: Commit**

```bash
git add server/src/tools.ts server/src/design-context.test.ts README.md docs/code-connect.md
git commit -m "feat: surface Code Connect mappings in design context"
```

---

## Done when

- `bun test` is green in `server/`, covering URL parsing, discovery, the `figma.connect` scanner, the index, the suggestion scorer and the writer.
- `bun run build` succeeds in both packages.
- `get_code_connect_map` returns real mappings from `*.figma.ts` files in the workspace and reports unparseable files by path rather than dropping them.
- `get_context_for_code_connect` refuses an instance with a message that says to select the main component.
- `get_code_connect_suggestions` ranks an exact name match first, with legible evidence, and writes nothing.
- `add_code_connect_map` writes a file that the parser can read back, refuses a duplicate mapping, and refuses a path outside the workspace.
- `get_design_context` opens with a Code Connect section when the node is mapped.
- `docs/code-connect.md` explains the local-file model and why there is no publish step.
