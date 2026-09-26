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
  return normalise(name).includes(needle);
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
      const exactSegment = segments(candidate.name).some((segment) => segment === needle);
      const startsWith = normalise(candidate.name).startsWith(needle);
      const score = exactSegment ? 1 : startsWith ? 0.8 : 0.5;
      return { ...candidate, score };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
};
