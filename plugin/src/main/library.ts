/**
 * Handlers for phase 5's identity and team-library tools.
 *
 * Every Figma surface is passed in rather than read off the `figma` global, so
 * the suite can drive these with stubbed `currentUser` and `teamLibrary`
 * objects and never needs a Figma session.
 */

import { withPermissionContext } from "./permissions";

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
 * @param teamLibrary - `figma.teamLibrary`.
 * @param collectionKey - A collection key from a previous call.
 */
export const getLibraries = async (
  teamLibrary: TeamLibraryLike,
  collectionKey?: string
): Promise<LibrariesResult> => {
  if (collectionKey) {
    const variables = await withPermissionContext("teamLibrary", () =>
      teamLibrary.getVariablesInLibraryCollectionAsync(collectionKey)
    );
    return {
      collectionKey,
      variables: variables.map(({ key, name, resolvedType }) => ({ key, name, resolvedType })),
      note: 'Pass a variable key to import_library_asset with kind "variable" to use it in this file.',
    };
  }

  const collections = await withPermissionContext("teamLibrary", () =>
    teamLibrary.getAvailableLibraryVariableCollectionsAsync()
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
