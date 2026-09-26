import { describe, expect, test } from "bun:test";
import {
  getLibraries,
  importLibraryAsset,
  searchDesignSystem,
  type SearchableNode,
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

describe("searchDesignSystem", () => {
  const set: SearchableNode = { id: "10:1", name: "Button", type: "COMPONENT_SET", key: "set-key" };
  const variant: SearchableNode = {
    id: "10:2",
    name: "Size=Large",
    type: "COMPONENT",
    key: "variant-key",
    parent: set,
  };
  const card: SearchableNode = { id: "11:1", name: "Card", type: "COMPONENT", key: "card-key" };
  const remoteSet: SearchableNode = {
    id: "20:1",
    name: "Button/Ghost",
    type: "COMPONENT_SET",
    key: "remote-set-key",
    remote: true,
  };
  const remoteVariant: SearchableNode = {
    id: "20:2",
    name: "State=Hover",
    type: "COMPONENT",
    key: "rv",
    remote: true,
    parent: remoteSet,
  };
  const instance: SearchableNode = {
    id: "30:1",
    name: "Ghost button",
    type: "INSTANCE",
    getMainComponentAsync: async () => remoteVariant,
  };
  const nodes = [set, variant, card, instance, { ...instance, id: "30:2" }];

  test("finds local components, representing a variant by its set", async () => {
    const result = await searchDesignSystem("button", { nodes, teamLibrary: stubTeamLibrary() });
    const ids = result.results.map((hit) => hit.id);
    expect(ids).toContain("10:1");
    expect(ids).not.toContain("10:2");
  });

  test("finds a library component through an instance of it, once, with its import key", async () => {
    const result = await searchDesignSystem("ghost", { nodes, teamLibrary: stubTeamLibrary() });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      id: "20:1",
      kind: "componentSet",
      key: "remote-set-key",
      remote: true,
    });
  });

  test("includes published variable collections with their library", async () => {
    const result = await searchDesignSystem("colors", { nodes, teamLibrary: stubTeamLibrary() });
    expect(result.results).toEqual([
      {
        id: "c1",
        key: "c1",
        name: "Colors",
        kind: "variableCollection",
        libraryName: "Core",
        score: 1,
      },
    ]);
  });

  test("still returns local results when team library reach is refused, and says so", async () => {
    const result = await searchDesignSystem("card", {
      nodes,
      teamLibrary: stubTeamLibrary({
        getAvailableLibraryVariableCollectionsAsync: async () => {
          throw new Error("Missing permission: teamlibrary");
        },
      }),
    });
    expect(result.results.map((hit) => hit.id)).toEqual(["11:1"]);
    expect(result.libraryError).toContain("manifest.json");
    expect(result.searched).not.toContain("published variable collections");
  });

  test("always says an empty result is not proof of absence", async () => {
    const result = await searchDesignSystem("zzz", { nodes, teamLibrary: stubTeamLibrary() });
    expect(result.results).toEqual([]);
    expect(result.note).toContain("does not mean");
  });

  test("rejects an empty query", async () => {
    await expect(
      searchDesignSystem("  ", { nodes, teamLibrary: stubTeamLibrary() })
    ).rejects.toThrow(/query/);
  });
});
