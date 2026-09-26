import { describe, expect, test } from "bun:test";
import {
  getLibraries,
  importLibraryAsset,
  whoami,
  type LibraryImporters,
  type TeamLibraryLike,
} from "./library";

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

const stubImporters = (): LibraryImporters & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    component: async (key) => (
      calls.push(`component:${key}`),
      { id: "1:1", name: "Button", type: "COMPONENT" }
    ),
    componentSet: async (key) => (
      calls.push(`componentSet:${key}`),
      { id: "1:2", name: "Button", type: "COMPONENT_SET" }
    ),
    style: async (key) => (
      calls.push(`style:${key}`),
      { id: "S:abc,", name: "Brand/Primary", type: "PAINT" }
    ),
    variable: async (key) => (
      calls.push(`variable:${key}`),
      { id: "VariableID:1:3", name: "color/bg" }
    ),
  };
};

describe("importLibraryAsset", () => {
  test.each([
    ["component", "COMPONENT"],
    ["componentSet", "COMPONENT_SET"],
    ["style", "PAINT"],
  ] as const)("imports a %s through its own importer and returns its id", async (kind, type) => {
    const importers = stubImporters();
    const result = await importLibraryAsset(importers, kind, "k1");
    expect(importers.calls).toEqual([`${kind}:k1`]);
    expect(result.kind).toBe(kind);
    expect(result.type).toBe(type);
    expect(result.id).toBeTruthy();
  });

  test("imports a variable, which has no node type", async () => {
    const result = await importLibraryAsset(stubImporters(), "variable", "k1");
    expect(result).toEqual({ kind: "variable", id: "VariableID:1:3", name: "color/bg" });
  });

  test("rejects an unknown kind, naming the valid ones", async () => {
    await expect(importLibraryAsset(stubImporters(), "page", "k1")).rejects.toThrow(
      /component, componentSet, style, variable/
    );
  });

  test("rejects a missing key", async () => {
    await expect(importLibraryAsset(stubImporters(), "component", "")).rejects.toThrow(/key/);
  });

  test("maps a permission refusal to the manifest fix", async () => {
    const importers = stubImporters();
    importers.component = async () => {
      throw new Error("Missing permission: teamlibrary");
    };
    await expect(importLibraryAsset(importers, "component", "k1")).rejects.toThrow(
      /manifest\.json/
    );
  });
});
