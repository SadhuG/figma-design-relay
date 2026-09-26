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
  /** Set by the plugin when it cut its own list to `limit`. */
  total?: number;
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
const RECONNECT =
  /disconnect|timed out|timeout|abort|not connected|no plugin connected|connection error/i;
// A plugin build older than the tool does not know the request at all.
const OUTDATED = /unknown request type/i;
const REBUILD = "Rebuild the plugin and run it in that file again.";

const isHit = (value: unknown): value is FileHit => {
  const hit = value as Partial<FileHit> | null;
  return (
    typeof hit === "object" &&
    hit !== null &&
    typeof hit.id === "string" &&
    typeof hit.name === "string" &&
    typeof hit.kind === "string" &&
    typeof hit.score === "number"
  );
};

// Checked hit by hit: one malformed entry must skip its file, not crash the whole search.
const isFileSearchResult = (value: unknown): value is FileSearchResult => {
  const candidate = value as { results?: unknown; searched?: unknown } | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    Array.isArray(candidate.results) &&
    candidate.results.every(isHit) &&
    Array.isArray(candidate.searched)
  );
};

const failureReason = (error: string): string => {
  if (OUTDATED.test(error)) return `${error} ${REBUILD}`;
  if (RECONNECT.test(error)) return `${error} Run the plugin in that file again, then retry.`;
  return error;
};

// The plugin ranks with localeCompare; a single-file search must keep its order.
const byName = (a: string, b: string): number => a.localeCompare(b);

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
        outcome.error ?? `The plugin returned a result this server cannot read. ${REBUILD}`
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
  // Each plugin already cut its own list to `limit` and said so in `total`. One file's total is
  // exact; across several files the overlap is unknown, so the largest one is a lower bound.
  const fileTotals = answered
    .map(({ result: each }) => each.total)
    .filter((total): total is number => typeof total === "number");
  const cut = merged.length > cap || fileTotals.length > 0;
  const total = Math.max(merged.length, ...fileTotals);
  const exact = fileTotals.length === 0 || answered.length === 1;
  if (cut) {
    note +=
      ` Only the ${Math.min(cap, merged.length)} strongest of ${exact ? "" : "at least "}${total} ` +
      `hits are returned; narrow the query or raise limit to see more.`;
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
  if (cut) result.total = total;

  // Library access belongs to the account, not the file, so one report is enough.
  const libraryError = answered.find(({ result: each }) => each.libraryError)?.result.libraryError;
  if (libraryError) result.libraryError = libraryError;

  if (input.outcomes.length === 1) {
    const only = answered[0].result.instanceError;
    if (only) result.instanceError = only;
  } else {
    const instanceErrors = answered
      .filter(({ result: each }) => each.instanceError)
      .map(({ file, result: each }) => ({
        fileName: file.fileName,
        message: each.instanceError as string,
      }));
    if (instanceErrors.length > 0) result.instanceErrors = instanceErrors;
  }

  return result;
};
