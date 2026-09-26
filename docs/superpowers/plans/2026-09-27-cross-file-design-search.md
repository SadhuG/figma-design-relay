# Cross-file design search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `search_design_system` call searches every open design file (or the ones the agent
names), returning one entry per component that points at the original and lists the other files.

**Architecture:** Server-only. Three pure modules under `server/src/search/`: file selection,
result merging, and an orchestrator that takes its I/O (list files, send one request) as
parameters. The tool handler in `tools.ts` wires the orchestrator to `node`. The plugin and bridge
are unchanged: each file still receives today's single-file request.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Zod 3, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-27-cross-file-design-search-design.md` (X1–X10).

## Global Constraints

- Server imports end in `.js` (`./select-files.js`), per `.claude/rules/server.md`.
- The tool description's **first sentence** says the relay is much narrower than Figma's own search.
- Errors say what to do next.
- Searchable editors: `figma`, `dev`, and a file with no `editorType`. Skipped: `figjam`, `slides`.
- `files`: 1–20 non-empty strings; each matches by exact fileKey or trimmed, case-insensitive name.
- `fileKey` and `files` together are refused. `fileKey` alone means exactly that file, with no
  editor filter (today's behaviour).
- Default `limit` 50; the per-file request is exactly `{ query, limit, allPages }`.
- No plugin, bridge or leader changes.
- Prettier via `bun run format` from the repo root; LF only.

## Review Focus

1. **Two open files with the same name** ("Untitled"): naming it selects both, and their hits stay
   apart by `fileKey`. Pinned in Task 1.
2. **The same file named twice** (by name and by fileKey): searched once, not twice. Pinned in
   Task 1.
3. **An older plugin build that returns an unexpected shape**: that file is skipped with a rebuild
   hint; the search does not crash. Pinned in Task 2.
4. **The same key under different kinds** (a component and a component set): never merged. Pinned
   in Task 2.
5. **Only a FigJam board is open**: the error says it was skipped as a FigJam board, not "no plugin
   connected". Pinned in Task 3.

---

### Task 1: File selection [X1, X2, X3]

**Files:**

- Create: `server/src/search/select-files.ts`
- Test: `server/src/search/select-files.test.ts`

**Interfaces:**

- Consumes: `ConnectedFile` from `server/src/types.ts`.
- Produces:
  - `interface SkippedFile { fileKey?: string; fileName: string; reason: string }`
  - `interface FileSelection { selected: ConnectedFile[]; skipped: SkippedFile[] }`
  - `selectSearchFiles(connected: readonly ConnectedFile[], request: { fileKey?: string; files?: readonly string[] }): FileSelection`

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import type { ConnectedFile } from "../types.js";
import { selectSearchFiles } from "./select-files.js";

const system: ConnectedFile = {
  fileKey: "k-sys",
  fileName: "Acme Design System",
  editorType: "figma",
};
const checkout: ConnectedFile = {
  fileKey: "k-co",
  fileName: "Checkout Screens",
  editorType: "figma",
};
const board: ConnectedFile = { fileKey: "k-fj", fileName: "Q3 Brainstorm", editorType: "figjam" };
const deck: ConnectedFile = { fileKey: "k-sl", fileName: "Pitch", editorType: "slides" };
const devMode: ConnectedFile = { fileKey: "k-dev", fileName: "Handoff", editorType: "dev" };
const legacy: ConnectedFile = { fileKey: "k-old", fileName: "Old Plugin File" };

const keys = (files: ConnectedFile[]) => files.map((file) => file.fileKey);

describe("selectSearchFiles by default", () => {
  test("selects every design file and skips FigJam and Slides with a reason", () => {
    const { selected, skipped } = selectSearchFiles([system, board, checkout, deck], {});
    expect(keys(selected)).toEqual(["k-sys", "k-co"]);
    expect(skipped).toEqual([
      {
        fileKey: "k-fj",
        fileName: "Q3 Brainstorm",
        reason: expect.stringContaining("FigJam board"),
      },
      { fileKey: "k-sl", fileName: "Pitch", reason: expect.stringContaining("Slides deck") },
    ]);
  });

  test("searches Dev Mode files and files whose plugin reports no editor", () => {
    expect(keys(selectSearchFiles([devMode, legacy], {}).selected)).toEqual(["k-dev", "k-old"]);
  });

  test("selects nothing and skips nothing when nothing is connected", () => {
    expect(selectSearchFiles([], {})).toEqual({ selected: [], skipped: [] });
  });
});

describe("selectSearchFiles with files", () => {
  test("matches names case-insensitively after trimming, and fileKeys exactly", () => {
    const { selected } = selectSearchFiles([system, checkout], {
      files: ["  acme design SYSTEM "],
    });
    expect(keys(selected)).toEqual(["k-sys"]);
    expect(keys(selectSearchFiles([system, checkout], { files: ["k-co"] }).selected)).toEqual([
      "k-co",
    ]);
  });

  test("selects every file sharing a name", () => {
    const a: ConnectedFile = { fileKey: "u1", fileName: "Untitled", editorType: "figma" };
    const b: ConnectedFile = { fileKey: "u2", fileName: "Untitled", editorType: "figma" };
    expect(keys(selectSearchFiles([a, b, system], { files: ["untitled"] }).selected)).toEqual([
      "u1",
      "u2",
    ]);
  });

  test("searches a file once when it is named twice", () => {
    const { selected } = selectSearchFiles([system], { files: ["Acme Design System", "k-sys"] });
    expect(keys(selected)).toEqual(["k-sys"]);
  });

  test("reports a name that is not open, listing the open files", () => {
    const { selected, skipped } = selectSearchFiles([system, checkout], { files: ["Acme DS v2"] });
    expect(selected).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].fileName).toBe("Acme DS v2");
    expect(skipped[0].reason).toContain("Not open");
    expect(skipped[0].reason).toContain('"Acme Design System", "Checkout Screens"');
  });

  test("still skips a named FigJam board", () => {
    const { selected, skipped } = selectSearchFiles([board], { files: ["Q3 Brainstorm"] });
    expect(selected).toEqual([]);
    expect(skipped[0].reason).toContain("FigJam board");
  });
});

describe("selectSearchFiles with fileKey", () => {
  test("selects exactly that file, whatever its editor", () => {
    expect(keys(selectSearchFiles([system, board], { fileKey: "k-fj" }).selected)).toEqual([
      "k-fj",
    ]);
  });

  test("reports an unknown fileKey with the open files", () => {
    const { selected, skipped } = selectSearchFiles([system], { fileKey: "nope" });
    expect(selected).toEqual([]);
    expect(skipped[0].reason).toContain('No plugin connected for fileKey "nope"');
    expect(skipped[0].reason).toContain('"Acme Design System"');
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd server && bun test src/search/select-files.test.ts`
Expected: FAIL, cannot resolve `./select-files.js`.

- [x] **Step 3: Implement**

```ts
import type { ConnectedFile } from "../types.js";

/** A file that was not searched, and why — reported, never thrown. */
export interface SkippedFile {
  /** Absent when the entry named no connected file. */
  fileKey?: string;
  fileName: string;
  reason: string;
}

export interface FileSelection {
  selected: ConnectedFile[];
  skipped: SkippedFile[];
}

/** Design files hold components; FigJam boards and Slides decks do not. */
const NOT_SEARCHED: Partial<Record<string, string>> = {
  figjam: "a FigJam board",
  slides: "a Slides deck",
};

const openFiles = (connected: readonly ConnectedFile[]): string =>
  connected.length === 0
    ? "No files are open with the plugin."
    : `Open files: ${connected.map((file) => `"${file.fileName}"`).join(", ")}.`;

const comparable = (name: string): string => name.trim().toLowerCase();

/**
 * Picks the connected files a search covers.
 * @param connected - The files `list_files` reports, in connection order.
 * @param request - `fileKey` for exactly one file, `files` to narrow by name or fileKey, or
 * neither for every design file.
 * @returns The files to search, in connection order, and the ones left out with a reason.
 */
export const selectSearchFiles = (
  connected: readonly ConnectedFile[],
  request: { fileKey?: string; files?: readonly string[] }
): FileSelection => {
  const selected: ConnectedFile[] = [];
  const skipped: SkippedFile[] = [];

  // fileKey keeps its old meaning — exactly this file — so it bypasses the editor filter.
  if (request.fileKey !== undefined) {
    const file = connected.find((entry) => entry.fileKey === request.fileKey);
    if (file) selected.push(file);
    else {
      skipped.push({
        fileName: request.fileKey,
        reason: `No plugin connected for fileKey "${request.fileKey}". ${openFiles(connected)}`,
      });
    }
    return { selected, skipped };
  }

  const take = (file: ConnectedFile): void => {
    const seen = [...selected, ...skipped].some((entry) => entry.fileKey === file.fileKey);
    if (seen) return;
    const editor = file.editorType ? NOT_SEARCHED[file.editorType] : undefined;
    if (editor) {
      skipped.push({
        fileKey: file.fileKey,
        fileName: file.fileName,
        reason: `Skipped: ${editor}. Only design files hold components to search.`,
      });
      return;
    }
    selected.push(file);
  };

  if (request.files === undefined) {
    connected.forEach(take);
    return { selected, skipped };
  }

  for (const entry of request.files) {
    const wanted = comparable(entry);
    const matches = connected.filter(
      (file) => file.fileKey === entry.trim() || comparable(file.fileName) === wanted
    );
    if (matches.length === 0) {
      skipped.push({
        fileName: entry,
        reason: `Not open with the plugin. ${openFiles(connected)}`,
      });
    } else {
      matches.forEach(take);
    }
  }
  return { selected, skipped };
};
```

- [x] **Step 4: Run to verify they pass**

Run: `cd server && bun test src/search/select-files.test.ts`
Expected: PASS, 10 tests.

- [x] **Step 5: Commit**

```bash
git add server/src/search/select-files.ts server/src/search/select-files.test.ts
git commit -m "feat(server): pick the files a cross-file search covers"
```

### Task 2: Merging per-file results [X5, X6, X7]

**Files:**

- Create: `server/src/search/merge.ts`
- Test: `server/src/search/merge.test.ts`

**Interfaces:**

- Consumes: `SkippedFile` from `./select-files.js`; `ConnectedFile` from `../types.js`.
- Produces:
  - `interface FileHit { id: string; name: string; kind: "component" | "componentSet" | "variableCollection"; key?: string; remote?: boolean; libraryName?: string; score: number }`
  - `interface FileOutcome { file: ConnectedFile; result?: unknown; error?: string }`
  - `interface MergedHit extends FileHit { fileKey: string; fileName: string; alsoIn?: Array<{ fileKey: string; fileName: string; id: string }> }`
  - `interface MergedSearchResult { results: MergedHit[]; searched: string[]; files: { searched: Array<{ fileKey: string; fileName: string }>; skipped: SkippedFile[] }; total?: number; libraryError?: string; instanceError?: string; instanceErrors?: Array<{ fileName: string; message: string }>; note: string }`
  - `mergeSearchResults(input: { outcomes: readonly FileOutcome[]; skipped: readonly SkippedFile[]; limit?: number; allPages?: boolean }): MergedSearchResult` — throws when no file answered.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import type { ConnectedFile } from "../types.js";
import { mergeSearchResults, type FileHit, type FileOutcome } from "./merge.js";

const system: ConnectedFile = {
  fileKey: "k-sys",
  fileName: "Acme Design System",
  editorType: "figma",
};
const checkout: ConnectedFile = {
  fileKey: "k-co",
  fileName: "Checkout Screens",
  editorType: "figma",
};
const onboarding: ConnectedFile = { fileKey: "k-on", fileName: "Onboarding", editorType: "figma" };

const SCOPES = [
  "components and component instances on the current page",
  "published variable collections",
];

const answered = (file: ConnectedFile, results: FileHit[], extra: object = {}): FileOutcome => ({
  file,
  result: { results, searched: SCOPES, note: "per-file note", ...extra },
});

const button = (id: string, remote?: boolean): FileHit => ({
  id,
  name: "Button",
  kind: "componentSet",
  key: "btn",
  score: 1,
  ...(remote ? { remote: true } : {}),
});

describe("mergeSearchResults grouping", () => {
  test("one entry per component, pointing at the original, with the other files under alsoIn", () => {
    const merged = mergeSearchResults({
      outcomes: [
        answered(checkout, [button("5:1", true)]),
        answered(system, [button("1:1")]),
        answered(onboarding, [button("7:1", true)]),
      ],
      skipped: [],
    });
    expect(merged.results).toEqual([
      {
        id: "1:1",
        name: "Button",
        kind: "componentSet",
        key: "btn",
        score: 1,
        fileKey: "k-sys",
        fileName: "Acme Design System",
        alsoIn: [
          { fileKey: "k-co", fileName: "Checkout Screens", id: "5:1" },
          { fileKey: "k-on", fileName: "Onboarding", id: "7:1" },
        ],
      },
    ]);
  });

  test("points at the first file's copy when no open file holds the original", () => {
    const merged = mergeSearchResults({
      outcomes: [
        answered(checkout, [button("5:1", true)]),
        answered(onboarding, [button("7:1", true)]),
      ],
      skipped: [],
    });
    expect(merged.results[0]).toMatchObject({
      id: "5:1",
      fileName: "Checkout Screens",
      remote: true,
    });
    expect(merged.results[0].alsoIn).toEqual([
      { fileKey: "k-on", fileName: "Onboarding", id: "7:1" },
    ]);
  });

  test("never merges hits without a key, or the same key under different kinds", () => {
    const unkeyed: FileHit = { id: "9:1", name: "Promo Button", kind: "component", score: 0.9 };
    const sameKeyComponent: FileHit = { ...button("2:2"), kind: "component" };
    const merged = mergeSearchResults({
      outcomes: [
        answered(system, [button("1:1"), unkeyed]),
        answered(checkout, [sameKeyComponent, unkeyed]),
      ],
      skipped: [],
    });
    expect(merged.results.map((hit) => `${hit.fileKey}/${hit.id}`).sort()).toEqual([
      "k-co/2:2",
      "k-co/9:1",
      "k-sys/1:1",
      "k-sys/9:1",
    ]);
    expect(merged.results.every((hit) => hit.alsoIn === undefined)).toBe(true);
  });

  test("lists a library variable collection once", () => {
    const colors: FileHit = {
      id: "c1",
      key: "c1",
      name: "Colors",
      kind: "variableCollection",
      libraryName: "Core",
      score: 1,
    };
    const merged = mergeSearchResults({
      outcomes: [answered(system, [colors]), answered(checkout, [colors])],
      skipped: [],
    });
    expect(merged.results).toHaveLength(1);
    expect(merged.results[0]).toMatchObject({
      fileName: "Acme Design System",
      alsoIn: [{ fileKey: "k-co", fileName: "Checkout Screens", id: "c1" }],
    });
  });
});

describe("mergeSearchResults ordering and cap", () => {
  test("orders by score, then originals before library copies, then name", () => {
    const hits: FileHit[] = [
      { id: "a", name: "Zeta", kind: "component", key: "z", score: 0.9 },
      { id: "b", name: "Alpha", kind: "component", key: "a", score: 0.9, remote: true },
      { id: "c", name: "Beta", kind: "component", key: "b", score: 0.9 },
      { id: "d", name: "Top", kind: "component", key: "t", score: 1 },
    ];
    const merged = mergeSearchResults({ outcomes: [answered(system, hits)], skipped: [] });
    expect(merged.results.map((hit) => hit.name)).toEqual(["Top", "Beta", "Zeta", "Alpha"]);
  });

  test("caps at limit and reports the merged total", () => {
    const hits: FileHit[] = ["A", "B", "C"].map((name) => ({
      id: name,
      name,
      kind: "component",
      key: name,
      score: 1,
    }));
    const merged = mergeSearchResults({
      outcomes: [answered(system, hits)],
      skipped: [],
      limit: 2,
    });
    expect(merged.results).toHaveLength(2);
    expect(merged.total).toBe(3);
    expect(merged.note).toContain("Only the 2 strongest of 3");
  });

  test("omits total when nothing was cut", () => {
    expect(
      mergeSearchResults({ outcomes: [answered(system, [button("1:1")])], skipped: [] }).total
    ).toBeUndefined();
  });
});

describe("mergeSearchResults files and errors", () => {
  test("lists searched and skipped files, turning a failure into a skip with the recovery step", () => {
    const merged = mergeSearchResults({
      outcomes: [
        answered(system, [button("1:1")]),
        { file: checkout, error: "Plugin disconnected: Checkout Screens (k-co)" },
      ],
      skipped: [{ fileKey: "k-fj", fileName: "Q3 Brainstorm", reason: "Skipped: a FigJam board." }],
    });
    expect(merged.files.searched).toEqual([{ fileKey: "k-sys", fileName: "Acme Design System" }]);
    expect(merged.files.skipped).toEqual([
      { fileKey: "k-fj", fileName: "Q3 Brainstorm", reason: "Skipped: a FigJam board." },
      {
        fileKey: "k-co",
        fileName: "Checkout Screens",
        reason: expect.stringContaining("Run the plugin in that file again"),
      },
    ]);
    expect(merged.note).toContain("files.skipped");
  });

  test("skips a file whose plugin returned a shape it cannot read", () => {
    const merged = mergeSearchResults({
      outcomes: [answered(system, [button("1:1")]), { file: checkout, result: { hits: [] } }],
      skipped: [],
    });
    expect(merged.files.skipped[0]).toMatchObject({
      fileName: "Checkout Screens",
      reason: expect.stringContaining("Rebuild"),
    });
  });

  test("throws, naming every file's reason, when no file answered", () => {
    expect(() =>
      mergeSearchResults({
        outcomes: [{ file: checkout, error: "Request timed out (3 minutes)" }],
        skipped: [
          { fileKey: "k-fj", fileName: "Q3 Brainstorm", reason: "Skipped: a FigJam board." },
        ],
      })
    ).toThrow(/No file could be searched.*Q3 Brainstorm.*FigJam.*Checkout Screens.*timed out/s);
  });

  test("throws the no-plugin error when nothing was connected", () => {
    expect(() => mergeSearchResults({ outcomes: [], skipped: [] })).toThrow(/No plugin connected/);
  });

  test("reports libraryError once and each file's instance error by name", () => {
    const merged = mergeSearchResults({
      outcomes: [
        answered(system, [], { libraryError: "needs a plan", instanceError: "sys broke" }),
        answered(checkout, [], { libraryError: "needs a plan", instanceError: "co broke" }),
      ],
      skipped: [],
    });
    expect(merged.libraryError).toBe("needs a plan");
    expect(merged.instanceErrors).toEqual([
      { fileName: "Acme Design System", message: "sys broke" },
      { fileName: "Checkout Screens", message: "co broke" },
    ]);
    expect(merged.instanceError).toBeUndefined();
  });

  test("keeps the single-file instanceError field for a one-file search", () => {
    const merged = mergeSearchResults({
      outcomes: [answered(system, [], { instanceError: "broke" })],
      skipped: [],
    });
    expect(merged.instanceError).toBe("broke");
    expect(merged.instanceErrors).toBeUndefined();
  });

  test("keeps each scope once and suggests allPages only when it was off", () => {
    const merged = mergeSearchResults({
      outcomes: [answered(system, []), answered(checkout, [])],
      skipped: [],
    });
    expect(merged.searched).toEqual(SCOPES);
    expect(merged.note).toContain("allPages: true");
    const all = mergeSearchResults({
      outcomes: [answered(system, [])],
      skipped: [],
      allPages: true,
    });
    expect(all.note).not.toContain("allPages: true");
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd server && bun test src/search/merge.test.ts`
Expected: FAIL, cannot resolve `./merge.js`.

- [x] **Step 3: Implement**

```ts
import type { ConnectedFile } from "../types.js";
import type { SkippedFile } from "./select-files.js";

/** One hit as a single file's plugin returns it (`plugin/src/main/search.ts`, `SearchHit`). */
export interface FileHit {
  id: string;
  name: string;
  kind: "component" | "componentSet" | "variableCollection";
  key?: string;
  remote?: boolean;
  libraryName?: string;
  score: number;
}

interface FileSearchResult {
  results: FileHit[];
  searched: string[];
  libraryError?: string;
  instanceError?: string;
}

/** What one file's request came back with: a plugin result, or why there is none. */
export interface FileOutcome {
  file: ConnectedFile;
  result?: unknown;
  error?: string;
}

export interface Appearance {
  fileKey: string;
  fileName: string;
  id: string;
}

export interface MergedHit extends FileHit {
  fileKey: string;
  fileName: string;
  /** Every other searched file the same component or collection appears in. */
  alsoIn?: Appearance[];
}

export interface MergedSearchResult {
  results: MergedHit[];
  searched: string[];
  files: { searched: Array<{ fileKey: string; fileName: string }>; skipped: SkippedFile[] };
  total?: number;
  libraryError?: string;
  /** A one-file search keeps the single-file field. */
  instanceError?: string;
  instanceErrors?: Array<{ fileName: string; message: string }>;
  note: string;
}

export const DEFAULT_SEARCH_LIMIT = 50;

// A dropped socket or a timeout is fixed by rerunning the plugin; say so.
const RECONNECT = /disconnect|timed out|not connected|connection error/i;

const isFileSearchResult = (value: unknown): value is FileSearchResult => {
  const candidate = value as { results?: unknown; searched?: unknown } | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    Array.isArray(candidate.results) &&
    Array.isArray(candidate.searched)
  );
};

const failureReason = (error: string): string =>
  RECONNECT.test(error) ? `${error} Run the plugin in that file again, then retry.` : error;

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Merges each file's search result into one answer: one entry per component or collection,
 * pointing at the original when an open file holds it.
 * @param input - Each selected file's outcome, the files selection already left out, and the
 * caller's `limit` and `allPages`.
 * @returns The merged result.
 * @throws When no file answered, naming every file's reason.
 */
export const mergeSearchResults = (input: {
  outcomes: readonly FileOutcome[];
  skipped: readonly SkippedFile[];
  limit?: number;
  allPages?: boolean;
}): MergedSearchResult => {
  const skipped: SkippedFile[] = [...input.skipped];
  const answered: Array<{ file: ConnectedFile; result: FileSearchResult }> = [];

  for (const outcome of input.outcomes) {
    if (outcome.error === undefined && isFileSearchResult(outcome.result)) {
      answered.push({ file: outcome.file, result: outcome.result });
      continue;
    }
    skipped.push({
      fileKey: outcome.file.fileKey,
      fileName: outcome.file.fileName,
      reason: failureReason(
        outcome.error ??
          "The plugin returned a result this server cannot read. Rebuild the plugin and run it in that file again."
      ),
    });
  }

  if (answered.length === 0) {
    if (skipped.length === 0) {
      throw new Error("No plugin connected. Open a Figma file and run the relay plugin.");
    }
    throw new Error(
      `No file could be searched. ${skipped.map((entry) => `"${entry.fileName}": ${entry.reason}`).join(" ")}`
    );
  }

  // Grouped by kind and key: the key is what identifies a component across files. A hit
  // without one is only ever itself.
  const groups = new Map<string, Array<{ file: ConnectedFile; hit: FileHit }>>();
  for (const { file, result } of answered) {
    for (const hit of result.results) {
      const identity = hit.key ? `${hit.kind}:${hit.key}` : `${file.fileKey}:${hit.id}`;
      const members = groups.get(identity) ?? [];
      members.push({ file, hit });
      groups.set(identity, members);
    }
  }

  const merged: MergedHit[] = [...groups.values()].map((members) => {
    const primary = members.find((member) => !member.hit.remote) ?? members[0];
    const hit: MergedHit = {
      ...primary.hit,
      score: Math.max(...members.map((member) => member.hit.score)),
      fileKey: primary.file.fileKey,
      fileName: primary.file.fileName,
    };
    const others = members.filter((member) => member !== primary);
    if (others.length > 0) {
      hit.alsoIn = others.map((member) => ({
        fileKey: member.file.fileKey,
        fileName: member.file.fileName,
        id: member.hit.id,
      }));
    }
    return hit;
  });

  merged.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.remote === true) - Number(b.remote === true) ||
      byName(a.name, b.name)
  );

  const cap =
    typeof input.limit === "number" && input.limit >= 1
      ? Math.floor(input.limit)
      : DEFAULT_SEARCH_LIMIT;

  const searched: string[] = [];
  for (const { result } of answered) {
    for (const scope of result.searched) if (!searched.includes(scope)) searched.push(scope);
  }

  let note =
    "This search covers only what is listed under `searched`, in the files under `files.searched`. " +
    "The Figma Plugin API cannot full-text search an organisation's published component libraries, " +
    "so an empty result does not mean the component does not exist — ask the user to open the " +
    "library file with the plugin and search again there.";
  if (!input.allPages) {
    note +=
      " Only each file's current page was searched; pass allPages: true to search every page " +
      "(slower on a large file).";
  }
  if (merged.length > cap) {
    note +=
      ` Only the ${cap} strongest of ${merged.length} hits are returned; narrow the query or ` +
      `raise limit to see more.`;
  }
  if (skipped.length > 0) note += " Some files were not searched; see files.skipped.";

  const result: MergedSearchResult = {
    results: merged.slice(0, cap),
    searched,
    files: {
      searched: answered.map(({ file }) => ({ fileKey: file.fileKey, fileName: file.fileName })),
      skipped,
    },
    note,
  };
  if (merged.length > cap) result.total = merged.length;

  // Library access belongs to the account, not the file, so one report is enough.
  const libraryError = answered.find(({ result: each }) => each.libraryError)?.result.libraryError;
  if (libraryError) result.libraryError = libraryError;

  if (input.outcomes.length === 1) {
    const only = answered[0].result.instanceError;
    if (only) result.instanceError = only;
  } else {
    const instanceErrors = answered
      .filter(({ result: each }) => each.instanceError)
      .map(({ file, result: each }) => ({ fileName: file.fileName, message: each.instanceError! }));
    if (instanceErrors.length > 0) result.instanceErrors = instanceErrors;
  }

  return result;
};
```

- [x] **Step 4: Run to verify they pass**

Run: `cd server && bun test src/search/merge.test.ts`
Expected: PASS, 13 tests.

- [x] **Step 5: Commit**

```bash
git add server/src/search/merge.ts server/src/search/merge.test.ts
git commit -m "feat(server): merge per-file search results, original first"
```

### Task 3: Fan-out, schema and the tool [X3, X4, X8]

**Files:**

- Create: `server/src/search/index.ts`
- Test: `server/src/search/index.test.ts`
- Modify: `server/src/schema.ts` (the `search_design_system` input), `server/src/schema.test.ts`
- Modify: `server/src/tools.ts` (the `list_files` handler's file lookup, the `search_design_system`
  registration)

**Interfaces:**

- Consumes: `selectSearchFiles` (Task 1), `mergeSearchResults` and `MergedSearchResult` (Task 2),
  `BridgeResponse` and `ConnectedFile` from `../types.js`.
- Produces:
  - `interface SearchIo { listFiles: () => Promise<ConnectedFile[]>; send: (params: Record<string, unknown>, fileKey: string) => Promise<BridgeResponse> }`
  - `searchAcrossFiles(io: SearchIo, args: { query: string; limit?: number; allPages?: boolean; fileKey?: string; files?: string[] }): Promise<MergedSearchResult>`

- [x] **Step 1: Write the failing orchestrator tests**

```ts
import { describe, expect, test } from "bun:test";
import type { BridgeResponse, ConnectedFile } from "../types.js";
import { searchAcrossFiles, type SearchIo } from "./index.js";

const system: ConnectedFile = {
  fileKey: "k-sys",
  fileName: "Acme Design System",
  editorType: "figma",
};
const checkout: ConnectedFile = {
  fileKey: "k-co",
  fileName: "Checkout Screens",
  editorType: "figma",
};
const board: ConnectedFile = { fileKey: "k-fj", fileName: "Q3 Brainstorm", editorType: "figjam" };

const ok = (data: unknown): BridgeResponse => ({
  type: "search_design_system",
  requestId: "r",
  data,
});
const empty = { results: [], searched: ["components and component instances on the current page"] };

const stub = (files: ConnectedFile[], reply: (fileKey: string) => Promise<BridgeResponse>) => {
  const sent: Array<{ fileKey: string; params: Record<string, unknown> }> = [];
  const io: SearchIo = {
    listFiles: async () => files,
    send: (params, fileKey) => {
      sent.push({ fileKey, params });
      return reply(fileKey);
    },
  };
  return { io, sent };
};

describe("searchAcrossFiles", () => {
  test("sends today's single-file request to every selected file", async () => {
    const { io, sent } = stub([system, checkout, board], async () => ok(empty));
    const result = await searchAcrossFiles(io, { query: "button", limit: 5, allPages: true });
    expect(sent).toEqual([
      { fileKey: "k-sys", params: { query: "button", limit: 5, allPages: true } },
      { fileKey: "k-co", params: { query: "button", limit: 5, allPages: true } },
    ]);
    expect(result.files.skipped.map((file) => file.fileName)).toEqual(["Q3 Brainstorm"]);
  });

  test("searches only the files named", async () => {
    const { io, sent } = stub([system, checkout], async () => ok(empty));
    await searchAcrossFiles(io, { query: "button", files: ["acme design system"] });
    expect(sent.map((call) => call.fileKey)).toEqual(["k-sys"]);
  });

  test("refuses fileKey and files together, before sending anything", async () => {
    const { io, sent } = stub([system], async () => ok(empty));
    await expect(
      searchAcrossFiles(io, { query: "b", fileKey: "k-sys", files: ["x"] })
    ).rejects.toThrow(/fileKey or files, not both/);
    expect(sent).toEqual([]);
  });

  test("turns a rejected request and a plugin error into skipped files", async () => {
    const { io } = stub(
      [system, checkout, { ...checkout, fileKey: "k-3", fileName: "Third" }],
      async (fileKey) => {
        if (fileKey === "k-co") throw new Error("Plugin disconnected: Checkout Screens (k-co)");
        if (fileKey === "k-3")
          return { type: "search_design_system", requestId: "r", error: "boom" };
        return ok(empty);
      }
    );
    const result = await searchAcrossFiles(io, { query: "button" });
    expect(result.files.searched.map((file) => file.fileName)).toEqual(["Acme Design System"]);
    expect(result.files.skipped.map((file) => [file.fileName, file.reason])).toEqual([
      ["Checkout Screens", expect.stringContaining("Run the plugin in that file again")],
      ["Third", "boom"],
    ]);
  });

  test("with only a FigJam board open, says it was skipped as one", async () => {
    const { io } = stub([board], async () => ok(empty));
    await expect(searchAcrossFiles(io, { query: "button" })).rejects.toThrow(
      /Q3 Brainstorm.*FigJam board/
    );
  });
});
```

- [x] **Step 2: Add the schema tests**

In `server/src/schema.test.ts`, inside `describe("validateRpc search_design_system", …)`:

```ts
test("forwards files", () => {
  const result = validateRpc("search_design_system", undefined, {
    query: "button",
    files: ["Acme"],
  });
  expect(result.params).toEqual({ query: "button", files: ["Acme"] });
});

test.each([[[]], [[""]], [Array.from({ length: 21 }, (_, i) => `f${i}`)]])(
  "rejects files of %p",
  (files) => {
    expect(
      validateRpc("search_design_system", undefined, { query: "button", files }).error
    ).toMatch(/files/);
  }
);
```

- [x] **Step 3: Run to verify they fail**

Run: `cd server && bun test src/search/index.test.ts src/schema.test.ts`
Expected: FAIL: `./index.js` does not resolve; the `files` tests fail because the key is stripped.

- [x] **Step 4: Implement the orchestrator**

`server/src/search/index.ts`:

```ts
import type { BridgeResponse, ConnectedFile } from "../types.js";
import { mergeSearchResults, type MergedSearchResult } from "./merge.js";
import { selectSearchFiles } from "./select-files.js";

/** The two pieces of I/O a search needs, so the fan-out is testable without a relay. */
export interface SearchIo {
  listFiles: () => Promise<ConnectedFile[]>;
  send: (params: Record<string, unknown>, fileKey: string) => Promise<BridgeResponse>;
}

/**
 * Runs `search_design_system` over the selected open files at once and merges the answers.
 * @param io - Lists the connected files and sends one file its request.
 * @param args - The tool's arguments.
 * @returns The merged result.
 * @throws When `fileKey` and `files` are both given, or when no file answered.
 */
export const searchAcrossFiles = async (
  io: SearchIo,
  args: { query: string; limit?: number; allPages?: boolean; fileKey?: string; files?: string[] }
): Promise<MergedSearchResult> => {
  if (args.fileKey !== undefined && args.files !== undefined) {
    throw new Error(
      "Pass fileKey or files, not both: fileKey searches exactly one file, files narrows a search " +
        "across the open files by name or fileKey."
    );
  }

  const { selected, skipped } = selectSearchFiles(await io.listFiles(), args);
  // Exactly what a single-file search sends today, so the plugin needs no change.
  const params = { query: args.query, limit: args.limit, allPages: args.allPages };
  const settled = await Promise.allSettled(selected.map((file) => io.send(params, file.fileKey)));

  const outcomes = selected.map((file, index) => {
    const outcome = settled[index];
    if (outcome.status === "rejected") {
      const reason = outcome.reason;
      return { file, error: reason instanceof Error ? reason.message : String(reason) };
    }
    if (outcome.value.error) return { file, error: outcome.value.error };
    return { file, result: outcome.value.data };
  });

  return mergeSearchResults({ outcomes, skipped, limit: args.limit, allPages: args.allPages });
};
```

- [x] **Step 5: Add `files` to the schema**

In `server/src/schema.ts`, in `search_design_system: z.object({ … })`, after `allPages`:

```ts
    files: z
      .array(z.string().trim().min(1, "files entries must not be empty"), {
        invalid_type_error: "files must be a list of file names or fileKeys",
      })
      .min(1, "files must name at least one file")
      .max(20, "files can name at most 20 files")
      .optional()
      .describe(
        "Only search these open files, by name (as list_files shows it, ignoring case) or fileKey. Omit to search every open design file. When many files are open, check their names with list_files and pass only the relevant ones. Cannot be combined with fileKey."
      ),
```

- [x] **Step 6: Wire the tool**

In `server/src/tools.ts`, import the orchestrator and the file type:

```ts
import { searchAcrossFiles } from "./search/index.js";
```

and add `ConnectedFile` to the existing `import type { BridgeResponse } from "./types.js";`.

At the top of `registerTools`, before the first `server.tool(`:

```ts
// The leader knows its files; a follower asks the leader.
const connectedFiles = async (): Promise<ConnectedFile[]> =>
  node.listConnectedFiles() ?? new Follower(`http://${LOOPBACK_HOST}:${port}`).listConnectedFiles();
```

In the `list_files` handler, replace the leader/follower branch with `const files = await connectedFiles();`.

Replace the `search_design_system` registration's description and handler:

```ts
("Search a NARROW slice of the design system — much narrower than Figma's own server: only components and component instances in the open design files (each file's current page, or every page with allPages: true), plus published variable collections. The Figma Plugin API cannot full-text search an organisation's published component libraries, so an empty result does NOT mean the component does not exist; retry with allPages: true, then ask the user to open the library file with the plugin and search there. Every open design file is searched at once unless files names some (by name or fileKey) — when many files are open, check their names with list_files and pass only the relevant ones; fileKey still searches exactly one file. FigJam boards and Slides decks are skipped. Each component appears once: fileKey and fileName say where the hit is, pointing at the original when an open file holds it, and alsoIn lists every other file it appears in with that file's node id. Each hit carries its kind, its key, and remote: true when it comes from a library. Only a remote hit's key is known to be importable with import_library_asset: a local component's key imports only if that component has been published, which the Plugin API cannot tell — in its own file, use its node id. Hits are ranked and capped at limit (default 50); total says how many matched when some were cut. files.searched and files.skipped say which files answered and why any did not; a file that failed does not fail the search. libraryError says why collections were skipped, and instanceError (instanceErrors, per file, when several were searched) why instances were skipped. allPages loads every page of every searched file first, which is slow on large files.",
  toolInputSchemas.search_design_system.shape,
  async ({ query, limit, allPages, fileKey, files }): Promise<ToolResult> => {
    try {
      const result = await searchAcrossFiles(
        {
          listFiles: connectedFiles,
          send: (params, key) =>
            node.sendWithParams("search_design_system", undefined, params, key),
        },
        { query, limit, allPages, fileKey, files }
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });
```

- [x] **Step 7: Run to verify they pass, then the whole suite and build**

Run: `cd server && bun test && bun run build`
Expected: PASS, no failures; `tsc` clean.

- [x] **Step 8: Commit**

```bash
git add server/src
git commit -m "feat(server): search_design_system searches every open design file"
```

### Task 4: Docs, live check and release [X8, X10]

**Files:**

- Modify: `docs/guides/libraries.md`, `README.md`, `docs/superpowers/README.md`,
  `docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md`,
  `docs/superpowers/specs/2026-09-27-cross-file-design-search-design.md` (status),
  `.claude/CLAUDE.md` (layout: `server/src/search/`), `CHANGELOG.md`

- [x] **Step 1: Libraries guide.** In "`search_design_system`: what it really searches": every open
      design file by default, `files` to narrow (names ignore case), FigJam/Slides skipped, one
      entry per component with `fileKey`/`fileName`/`alsoIn`, originals first, `files.searched` /
      `files.skipped`, `instanceErrors`, and a new example response with two files.
- [x] **Step 2: README.** Tool-table row and the library note: every open design file, `files`.
- [x] **Step 3: Design history.** R40 row → delivered, citing this plan; parity spec status line;
      this spec's status → delivered; the plan listed under "Other specs".
- [ ] **Step 4: Live check (X10).** Build this worktree, import its dev plugin into a design-system
      file and a screen file that uses it, and with the smoke harness
      (`node server/.smoke/call.mjs search_design_system '{"query":"<component>"}'`) confirm one hit
      whose `fileName` is the design-system file, with the screen file under `alsoIn`. Close the
      plugin in one file and confirm the search still answers and lists it under `files.skipped`.
- [ ] **Step 5: `finish-task`** — facts, version, changelog, separate-agent review, merge.
