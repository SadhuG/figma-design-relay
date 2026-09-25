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
 * capitalised, exported, in a source file. Links resolving outside the
 * workspace are skipped, as in discovery.
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
        const resolved = await realpath(full);
        if (!resolved.startsWith(base + path.sep)) continue;
        source = await readFile(resolved, "utf8");
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
