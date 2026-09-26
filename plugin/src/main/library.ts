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
    const variables = await withPermissionContext(
      "teamLibrary",
      () => readTeamLibrary().getVariablesInLibraryCollectionAsync(collectionKey),
      "Pass a collection key returned by get_libraries without a collectionKey, for this file — " +
        "collection keys are not node ids or variable keys."
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

  // A permission or plan refusal already names its fix; anything else is
  // almost always a key Figma cannot resolve, and its message stops there.
  const imported = await withPermissionContext(
    "teamLibrary",
    () => importers[kind](key),
    `The key must belong to a ${kind} published in a library that is enabled for this file ` +
      `(Assets → Libraries). A component that only exists locally in this file is not ` +
      `importable — use its node id directly instead.`
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
  /** COMPONENT, COMPONENT_SET and INSTANCE nodes from {@link findSearchableNodes}. */
  nodes: readonly SearchableNode[];
  /** True when `nodes` came from every page rather than the current one. */
  allPages?: boolean;
  /** Reads `figma.teamLibrary`; the read itself throws without the permission. */
  readTeamLibrary: () => TeamLibraryLike;
}

export interface SearchResult {
  results: SearchHit[];
  searched: string[];
  /** How many hits matched, present only when `results` was cut to the limit. */
  total?: number;
  /** Why published variable collections were not searched, when they were not. */
  libraryError?: string;
  /** Why instances were skipped, when their main components could not be read. */
  instanceError?: string;
  note: string;
}

const PAGE_SCOPE = "components and component instances on the current page";
const DOCUMENT_SCOPE = "components and component instances on every page";
const LIBRARY_SCOPE = "published variable collections";
const SEARCHABLE_TYPES = ["COMPONENT", "COMPONENT_SET", "INSTANCE"];

/** The parts of the `figma` global {@link findSearchableNodes} reads. */
export interface SearchRoots {
  currentPage: { findAllWithCriteria: (criteria: { types: string[] }) => readonly unknown[] };
  root: { findAllWithCriteria: (criteria: { types: string[] }) => readonly unknown[] };
  loadAllPagesAsync: () => Promise<void>;
}

/**
 * Collects the nodes `search_design_system` ranks. Under dynamic page loading
 * only the current page is loaded, and loading the rest is slow on a large
 * file — so every page is searched only when the caller asks for it.
 * @param roots - `figma`, or a stub of it.
 * @param allPages - Load and search every page instead of the current one.
 */
export const findSearchableNodes = async (
  roots: SearchRoots,
  allPages: boolean
): Promise<SearchableNode[]> => {
  if (!allPages) {
    return roots.currentPage.findAllWithCriteria({
      types: SEARCHABLE_TYPES,
    }) as SearchableNode[];
  }
  await roots.loadAllPagesAsync();
  return roots.root.findAllWithCriteria({ types: SEARCHABLE_TYPES }) as SearchableNode[];
};

export const DEFAULT_SEARCH_LIMIT = 50;
const MAIN_COMPONENT_BATCH = 64;

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
 * @param limit - Most hits to return; {@link DEFAULT_SEARCH_LIMIT} when absent.
 */
export const searchDesignSystem = async (
  query: unknown,
  sources: SearchSources,
  limit?: unknown
): Promise<SearchResult> => {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("search_design_system requires a non-empty `query` string parameter.");
  }

  const byId = new Map<string, SearchCandidate>();
  const add = (candidate: SearchCandidate | null) => {
    if (candidate && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
  };

  const instances: SearchableNode[] = [];
  for (const node of sources.nodes) {
    if (node.type === "INSTANCE" && node.getMainComponentAsync) instances.push(node);
    else add(toCandidate(node));
  }

  // Resolve instances a batch at a time: a large page holds thousands, and
  // Figma is not asked to load every main component at once.
  let instanceError: string | undefined;
  for (let start = 0; start < instances.length; start += MAIN_COMPONENT_BATCH) {
    const batch = instances.slice(start, start + MAIN_COMPONENT_BATCH);
    const mains = await Promise.all(
      // One unreadable main component must not sink the whole search.
      batch.map((node) => node.getMainComponentAsync!().catch(() => null))
    );
    for (const main of mains) if (main) add(toCandidate(main));

    // A whole batch failing is not one broken instance but a sandbox that cannot
    // load main components — after a hot reload each lookup takes seconds and
    // throws — so the rest would only fail the same way, slowly.
    if (batch.length === MAIN_COMPONENT_BATCH && mains.every((main) => main === null)) {
      instanceError =
        `The main components of ${MAIN_COMPONENT_BATCH} instances in a row could not be read, ` +
        `so the remaining ${instances.length - start - batch.length} instances were skipped. ` +
        `If the plugin was hot-reloaded after a rebuild, close it and run it again from ` +
        `Figma's Development menu, then retry.`;
      break;
    }
  }

  const searched = [sources.allPages ? DOCUMENT_SCOPE : PAGE_SCOPE];
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

  const hits = rankResults(query, [...byId.values()]);
  const cap = typeof limit === "number" && limit >= 1 ? Math.floor(limit) : DEFAULT_SEARCH_LIMIT;
  let note =
    "This search covers only what is listed under `searched`. The Figma Plugin API cannot " +
    "full-text search an organisation's published component libraries, so an empty result " +
    "does not mean the component does not exist — ask the user to open the library file " +
    "with the plugin and search again there.";
  if (!sources.allPages) {
    note +=
      " Only the current page was searched; pass allPages: true to search every page of " +
      "this file (slower on a large file).";
  }
  if (hits.length > cap) {
    note +=
      ` Only the ${cap} strongest of ${hits.length} hits are returned; narrow the query or ` +
      `raise limit to see more.`;
  }

  const result: SearchResult = { results: hits.slice(0, cap), searched, note };
  if (hits.length > cap) result.total = hits.length;
  if (libraryError) result.libraryError = libraryError;
  if (instanceError) result.instanceError = instanceError;
  return result;
};
