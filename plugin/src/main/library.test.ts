import { describe, expect, test } from "bun:test";
import { getLibraries, whoami, type TeamLibraryLike } from "./library";

describe("whoami", () => {
  test("returns the signed-in user's id, name and photo", async () => {
    const result = await whoami(() => ({
      id: "123",
      name: "Ada",
      photoUrl: "https://example.com/ada.png",
      color: "#f00",
      sessionId: 7,
    }));
    expect(result).toEqual({
      user: { id: "123", name: "Ada", photoUrl: "https://example.com/ada.png" },
    });
  });

  test("returns an explicit no-user result rather than an empty object", async () => {
    const result = await whoami(() => null);
    expect(result.user).toBeNull();
    expect(result.note).toContain("currentuser");
  });

  test("maps a permission refusal to the manifest fix", async () => {
    const failing = whoami(() => {
      throw new Error('"currentuser" permission is required to access figma.currentUser');
    });
    await expect(failing).rejects.toThrow(/manifest\.json/);
  });
});

const stubTeamLibrary = (overrides: Partial<TeamLibraryLike> = {}): TeamLibraryLike => ({
  getAvailableLibraryVariableCollectionsAsync: async () => [
    { key: "c1", name: "Colors", libraryName: "Core" },
    { key: "c2", name: "Spacing", libraryName: "Core" },
    { key: "c3", name: "Brand", libraryName: "Marketing" },
  ],
  getVariablesInLibraryCollectionAsync: async (key) =>
    key === "c1"
      ? [
          { key: "v1", name: "color/bg", resolvedType: "COLOR" },
          { key: "v2", name: "color/fg", resolvedType: "COLOR" },
        ]
      : [],
  ...overrides,
});

describe("getLibraries", () => {
  test("groups published variable collections by library, keeping each key", async () => {
    const result = await getLibraries(stubTeamLibrary());
    expect(result.libraries).toEqual([
      {
        name: "Core",
        collections: [
          { key: "c1", name: "Colors" },
          { key: "c2", name: "Spacing" },
        ],
      },
      { name: "Marketing", collections: [{ key: "c3", name: "Brand" }] },
    ]);
    expect(result.note).toContain("not a full component catalogue");
  });

  test("lists one collection's variables with their import keys when given a collection key", async () => {
    const result = await getLibraries(stubTeamLibrary(), "c1");
    expect(result.variables).toEqual([
      { key: "v1", name: "color/bg", resolvedType: "COLOR" },
      { key: "v2", name: "color/fg", resolvedType: "COLOR" },
    ]);
  });

  test("returns an empty list, not an error, when no library is enabled", async () => {
    const result = await getLibraries(
      stubTeamLibrary({ getAvailableLibraryVariableCollectionsAsync: async () => [] })
    );
    expect(result.libraries).toEqual([]);
  });

  test("maps a plan refusal to a message naming the plan and the permission", async () => {
    const failing = getLibraries(
      stubTeamLibrary({
        getAvailableLibraryVariableCollectionsAsync: async () => {
          throw new Error("This API is only available on paid plans");
        },
      })
    );
    await expect(failing).rejects.toThrow(/plan.*teamlibrary/s);
  });
});
