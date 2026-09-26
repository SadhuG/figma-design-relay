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
  /** The published key, which is what `import_library_asset` takes. */
  key?: string;
  /** True when the component comes from a library rather than this file. */
  remote?: boolean;
  libraryName?: string;
}

export interface SearchHit extends SearchCandidate {
  /** 0-1; higher is a stronger match. */
  score: number;
}

// Whitespace and ASCII punctuation. Everything else is kept, so a query in any
// script still has something to match. A `\p{L}` class would say this more
// directly, but the plugin builds to es2015 and the sandbox is not promised to
// support Unicode property escapes.
const SEPARATORS = /[\s!-/:-@[-`{-~]+/g;

const normalise = (value: string): string =>
  value.normalize("NFC").toLowerCase().replace(SEPARATORS, "");

const segments = (name: string): string[] => name.split("/").map(normalise).filter(Boolean);

const words = (name: string): string[] => name.split(SEPARATORS).map(normalise).filter(Boolean);

/**
 * Reports whether a name matches a query, ignoring case and separators.
 * @param query - The caller's search text.
 * @param name - The candidate's name, possibly a `Group/Name` path.
 */
export const matchesQuery = (query: string, name: string): boolean => {
  const needle = normalise(query);
  if (needle === "") return false;
  return normalise(name).includes(needle);
};

/**
 * Scores a matching name: 1 for the whole name or one `/` segment, 0.9 for a
 * whole word, 0.8 for a prefix of the name, 0.7 for a prefix of a word, 0.5
 * for any other substring.
 * @param needle - The normalised query.
 * @param name - The candidate's raw name.
 */
const scoreName = (needle: string, name: string): number => {
  const whole = normalise(name);
  if (whole === needle || segments(name).includes(needle)) return 1;
  const nameWords = words(name);
  if (nameWords.includes(needle)) return 0.9;
  if (whole.startsWith(needle)) return 0.8;
  if (nameWords.some((word) => word.startsWith(needle))) return 0.7;
  return 0.5;
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
    .map((candidate) => ({ ...candidate, score: scoreName(needle, candidate.name) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
};
