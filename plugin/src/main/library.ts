/**
 * Handlers for phase 5's identity and team-library tools.
 *
 * Every Figma surface is passed in rather than read off the `figma` global, so
 * the suite can drive these with stubbed `currentUser` and `teamLibrary`
 * objects and never needs a Figma session.
 */

import { describeApiError, withPermissionContext } from "./permissions";
import { rankResults, type SearchCandidate, type SearchHit } from "./search";

/** The fields of Figma's `User` this module reads. */
export interface CurrentUserLike {
  id: string | null;
  name: string;
  photoUrl: string | null;
}

export interface WhoamiResult {
  user: { id: string | null; name: string; photoUrl: string | null } | null;
  note?: string;
}

/**
 * Reports the signed-in user.
 * @param readUser - Reads `figma.currentUser`. A getter, because reading the
 *   property is itself what throws when the permission is missing.
 */
export const whoami = async (readUser: () => CurrentUserLike | null): Promise<WhoamiResult> => {
  const user = await withPermissionContext("currentUser", async () => readUser());
  if (!user) {
    return {
      user: null,
      note:
        "No current user is available. This happens when the plugin runs without the " +
        '"currentuser" permission, or in a context where Figma does not expose one. ' +
        "Relaunch the plugin from this checkout's manifest and retry.",
    };
  }
  return { user: { id: user.id, name: user.name, photoUrl: user.photoUrl } };
};

/** The fields of Figma's `figma.teamLibrary` this module calls. */
export interface TeamLibraryLike {
  getAvailableLibraryVariableCollectionsAsync(): Promise<
    Array<{ key: string; name: string; libraryName: string }>
  >;
  getVariablesInLibraryCollectionAsync(
    collectionKey: string
  ): Promise<Array<{ key: string; name: string; resolvedType: string }>>;
}

export interface LibrariesResult {
  libraries?: Array<{ name: string; collections: Array<{ key: string; name: string }> }>;
  collectionKey?: string;
  variables?: Array<{ key: string; name: string; resolvedType: string }>;
  note: string;
}

/**
 * Lists published libraries by their variable collections, or — given a
 * collection key — that collection's variables with the keys
 * `import_library_asset` takes.
 * @param readTeamLibrary - Reads `figma.teamLibrary`. A getter, because without the
 *   permission the property read itself throws.
 * @param collectionKey - A collection key from a previous call.
 */
export const getLibraries = async (
  readTeamLibrary: () => TeamLibraryLike,
  collectionKey?: string
): Promise<LibrariesResult> => {
  if (collectionKey) {
    const variables = await withPermissionContext("teamLibrary", () =>
      readTeamLibrary().getVariablesInLibraryCollectionAsync(collectionKey)
    );
    return {
      collectionKey,
      variables: variables.map(({ key, name, resolvedType }) => ({ key, name, resolvedType })),
      note: 'Pass a variable key to import_library_asset with kind "variable" to use it in this file.',
    };
  }

  const collections = await withPermissionContext("teamLibrary", () =>
    readTeamLibrary().getAvailableLibraryVariableCollectionsAsync()
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
    libraries: [...byLibrary.entries()].map(([name, list]) => ({ name, collections: list })),
    note:
      "The Plugin API exposes published variable collections per library, not a full component " +
      "catalogue. Libraries that publish no variables do not appear here. Pass a collection key " +
      "back as collectionKey to list its variables; use search_design_system for components.",
  };
};

export const IMPORTABLE_KINDS = ["component", "componentSet", "style", "variable"] as const;
export type ImportableKind = (typeof IMPORTABLE_KINDS)[number];

interface Imported {
  id: string;
  name: string;
  type?: string;
}

/**
 * Figma's four import-by-key calls, one per kind: `importComponentByKeyAsync`,
 * `importComponentSetByKeyAsync`, `importStyleByKeyAsync` and
 * `variables.importVariableByKeyAsync`.
 */
export type LibraryImporters = Record<ImportableKind, (key: string) => Promise<Imported>>;

export interface ImportResult {
  kind: ImportableKind;
  id: string;
  name: string;
  /** The node or style type; absent for a variable, which has none. */
  type?: string;
}

const isImportableKind = (kind: unknown): kind is ImportableKind =>
  (IMPORTABLE_KINDS as readonly unknown[]).includes(kind);

/**
 * Imports a published asset by key and returns the id a later call can place
 * or bind.
 * @param importers - The Plugin API's import-by-key calls.
 * @param kind - Which importer the key belongs to.
 * @param key - The published key.
 */
export const importLibraryAsset = async (
  importers: LibraryImporters,
  kind: unknown,
  key: unknown
): Promise<ImportResult> => {
  if (!isImportableKind(kind)) {
    throw new Error(`Unknown kind "${String(kind)}". Use one of: ${IMPORTABLE_KINDS.join(", ")}.`);
  }
  if (typeof key !== "string" || key === "") {
    throw new Error("import_library_asset requires a non-empty `key` string parameter.");
  }

  const imported = await withPermissionContext("teamLibrary", () => importers[kind](key)).catch(
    (error: Error) => {
      // A permission or plan refusal already names its fix; anything else is
      // almost always a key Figma cannot resolve, and its message stops there.
      if (/permission|\bplans?\b/i.test(error.message)) throw error;
      throw new Error(
        `${error.message}. The key must belong to a ${kind} published in a library that is ` +
          `enabled for this file (Assets → Libraries). A component that only exists locally ` +
          `in this file is not importable — use its node id directly instead.`
      );
    }
  );
  const result: ImportResult = { kind, id: imported.id, name: imported.name };
  if (imported.type !== undefined) result.type = imported.type;
  return result;
};

/** The fields of a COMPONENT, COMPONENT_SET or INSTANCE node the search reads. */
export interface SearchableNode {
  id: string;
  name: string;
  type: string;
  key?: string;
  remote?: boolean;
  parent?: SearchableNode | null;
  getMainComponentAsync?: () => Promise<SearchableNode | null>;
}

export interface SearchSources {
  /** COMPONENT, COMPONENT_SET and INSTANCE nodes on the current page. */
  nodes: readonly SearchableNode[];
  /** Reads `figma.teamLibrary`; the read itself throws without the permission. */
  readTeamLibrary: () => TeamLibraryLike;
}

export interface SearchResult {
  results: SearchHit[];
  searched: string[];
  /** Why published variable collections were not searched, when they were not. */
  libraryError?: string;
  note: string;
}

const PAGE_SCOPE = "components and component instances on the current page";
const LIBRARY_SCOPE = "published variable collections";

const toCandidate = (node: SearchableNode): SearchCandidate | null => {
  // A variant's own name is its property string; the set is what gets searched
  // for and imported.
  const target =
    node.type === "COMPONENT" && node.parent?.type === "COMPONENT_SET" ? node.parent : node;
  if (target.type !== "COMPONENT" && target.type !== "COMPONENT_SET") return null;
  const candidate: SearchCandidate = {
    id: target.id,
    name: target.name,
    kind: target.type === "COMPONENT_SET" ? "componentSet" : "component",
  };
  if (target.key) candidate.key = target.key;
  if (target.remote) candidate.remote = true;
  return candidate;
};

/**
 * Searches what the plugin can actually reach: components on the current page,
 * the main components of instances there (which is how library components are
 * found), and published variable collections when the plan allows it.
 * @param query - The caller's search text.
 * @param sources - The page's component-ish nodes and `figma.teamLibrary`.
 */
export const searchDesignSystem = async (
  query: unknown,
  sources: SearchSources
): Promise<SearchResult> => {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("search_design_system requires a non-empty `query` string parameter.");
  }

  const byId = new Map<string, SearchCandidate>();
  const add = (candidate: SearchCandidate | null) => {
    if (candidate && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
  };

  const mains = await Promise.all(
    sources.nodes.map((node) =>
      node.type === "INSTANCE" && node.getMainComponentAsync
        ? // One unreadable main component must not sink the whole search.
          node.getMainComponentAsync().catch(() => null)
        : Promise.resolve(node)
    )
  );
  for (const node of mains) if (node) add(toCandidate(node));

  const searched = [PAGE_SCOPE];
  let libraryError: string | undefined;
  try {
    const collections = await sources
      .readTeamLibrary()
      .getAvailableLibraryVariableCollectionsAsync();
    for (const collection of collections) {
      add({
        id: collection.key,
        key: collection.key,
        name: collection.name,
        kind: "variableCollection",
        libraryName: collection.libraryName,
      });
    }
    searched.push(LIBRARY_SCOPE);
  } catch (error) {
    // Library reach is optional: local results are still worth returning.
    libraryError = describeApiError(error, "teamLibrary");
  }

  const result: SearchResult = {
    results: rankResults(query, [...byId.values()]),
    searched,
    note:
      "This search covers only what is listed under `searched`. The Figma Plugin API cannot " +
      "full-text search an organisation's published component libraries, so an empty result " +
      "does not mean the component does not exist — ask the user to open the library file " +
      "with the plugin and search again there.",
  };
  if (libraryError) result.libraryError = libraryError;
  return result;
};
