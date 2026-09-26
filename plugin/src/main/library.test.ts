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

const stubTeamLibrary =
  (overrides: Partial<TeamLibraryLike> = {}): (() => TeamLibraryLike) =>
  () => ({
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
    const result = await searchDesignSystem("button", {
      nodes,
      readTeamLibrary: stubTeamLibrary(),
    });
    const ids = result.results.map((hit) => hit.id);
    expect(ids).toContain("10:1");
    expect(ids).not.toContain("10:2");
  });

  test("finds a library component through an instance of it, once, with its import key", async () => {
    const result = await searchDesignSystem("ghost", { nodes, readTeamLibrary: stubTeamLibrary() });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      id: "20:1",
      kind: "componentSet",
      key: "remote-set-key",
      remote: true,
    });
  });

  test("includes published variable collections with their library", async () => {
    const result = await searchDesignSystem("colors", {
      nodes,
      readTeamLibrary: stubTeamLibrary(),
    });
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
      readTeamLibrary: stubTeamLibrary({
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
    const result = await searchDesignSystem("zzz", { nodes, readTeamLibrary: stubTeamLibrary() });
    expect(result.results).toEqual([]);
    expect(result.note).toContain("does not mean");
  });

  test("rejects an empty query", async () => {
    await expect(
      searchDesignSystem("  ", { nodes, readTeamLibrary: stubTeamLibrary() })
    ).rejects.toThrow(/query/);
  });
});

describe("importLibraryAsset failures", () => {
  test("says what to do when Figma cannot import the key", async () => {
    const importers = stubImporters();
    importers.componentSet = async () => {
      throw new Error('Failed to import component set by key "abc"');
    };
    const failing = importLibraryAsset(importers, "componentSet", "abc");
    await expect(failing).rejects.toThrow(/Failed to import component set by key "abc"/);
    await expect(importLibraryAsset(importers, "componentSet", "abc")).rejects.toThrow(
      /published.*enabled.*local/s
    );
  });

  test("joins Figma's sentence and the guidance cleanly", async () => {
    const importers = stubImporters();
    importers.component = async () => {
      throw new Error("Could not find a published component with key abc.");
    };
    const error = await importLibraryAsset(importers, "component", "abc").catch((e: Error) => e);
    expect((error as Error).message).toStartWith(
      "Could not find a published component with key abc. The key must belong"
    );
  });

  test("treats an access refusal as a key problem, not a missing manifest permission", async () => {
    const importers = stubImporters();
    importers.component = async () => {
      throw new Error("You do not have permission to access this component");
    };
    const error = await importLibraryAsset(importers, "component", "abc").catch((e: Error) => e);
    expect((error as Error).message).toContain("enabled for this file");
    expect((error as Error).message).not.toContain("manifest.json");
  });

  test("maps an importer that throws synchronously", async () => {
    const importers = stubImporters();
    importers.style = (() => {
      throw new Error("Invalid key");
    }) as unknown as LibraryImporters["style"];
    await expect(importLibraryAsset(importers, "style", "abc")).rejects.toThrow(
      /Invalid key\. The key must belong to a style/
    );
  });
});

describe("getLibraries failures", () => {
  test("says where a collection key comes from when Figma rejects it", async () => {
    const failing = getLibraries(
      stubTeamLibrary({
        getVariablesInLibraryCollectionAsync: async () => {
          throw new Error("Collection not found");
        },
      }),
      "nope"
    );
    await expect(failing).rejects.toThrow(
      /^Collection not found\. Pass a collection key returned by get_libraries/
    );
  });
});

describe("reading figma.teamLibrary itself", () => {
  // Without the manifest permission Figma throws on the property read, before
  // any method is called — so the read has to happen inside the mapper.
  const refuse = (): TeamLibraryLike => {
    throw new Error('in get_teamLibrary: "teamlibrary" permission not specified in manifest.json.');
  };

  test("get_libraries maps a refused read to the manifest fix", async () => {
    await expect(getLibraries(refuse)).rejects.toThrow(/add it to the "permissions" array/i);
  });

  test("search_design_system degrades to local results on a refused read", async () => {
    const card: SearchableNode = { id: "11:1", name: "Card", type: "COMPONENT" };
    const result = await searchDesignSystem("card", { nodes: [card], readTeamLibrary: refuse });
    expect(result.results.map((hit) => hit.id)).toEqual(["11:1"]);
    expect(result.libraryError).toContain("manifest.json");
  });
});

describe("searchDesignSystem limits", () => {
  const many: SearchableNode[] = Array.from({ length: 60 }, (_, i) => ({
    id: `40:${i}`,
    name: `Button ${String(i).padStart(2, "0")}`,
    type: "COMPONENT",
  }));

  test("returns at most 50 hits by default and says how many matched", async () => {
    const result = await searchDesignSystem("button", {
      nodes: many,
      readTeamLibrary: stubTeamLibrary(),
    });
    expect(result.results).toHaveLength(50);
    expect(result.total).toBe(60);
    expect(result.note).toContain("limit");
  });

  test("honours a caller's limit", async () => {
    const result = await searchDesignSystem(
      "button",
      { nodes: many, readTeamLibrary: stubTeamLibrary() },
      3
    );
    expect(result.results.map((hit) => hit.name)).toEqual(["Button 00", "Button 01", "Button 02"]);
    expect(result.total).toBe(60);
  });

  test("omits total when nothing was cut", async () => {
    const result = await searchDesignSystem("card", {
      nodes: [{ id: "11:1", name: "Card", type: "COMPONENT" }],
      readTeamLibrary: stubTeamLibrary(),
    });
    expect(result.total).toBeUndefined();
  });

  test("never has more than 64 main-component lookups in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const main: SearchableNode = { id: "50:1", name: "Chip", type: "COMPONENT" };
    const instances: SearchableNode[] = Array.from({ length: 200 }, (_, i) => ({
      id: `51:${i}`,
      name: "Chip",
      type: "INSTANCE",
      getMainComponentAsync: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return main;
      },
    }));
    const result = await searchDesignSystem("chip", {
      nodes: instances,
      readTeamLibrary: stubTeamLibrary(),
    });
    expect(peak).toBeLessThanOrEqual(64);
    expect(result.results.map((hit) => hit.id)).toEqual(["50:1"]);
  });

  test("stops resolving instances once a whole batch fails, and says why", async () => {
    let calls = 0;
    const instances: SearchableNode[] = Array.from({ length: 200 }, (_, i) => ({
      id: `52:${i}`,
      name: "Chip",
      type: "INSTANCE",
      getMainComponentAsync: async () => {
        calls++;
        throw new Error("Failed to load");
      },
    }));
    const card: SearchableNode = { id: "11:1", name: "Card", type: "COMPONENT" };
    const result = await searchDesignSystem("card", {
      nodes: [card, ...instances],
      readTeamLibrary: stubTeamLibrary(),
    });
    expect(calls).toBe(64);
    expect(result.results.map((hit) => hit.id)).toEqual(["11:1"]);
    expect(result.instanceError).toContain("Development menu");
  });
});

describe("searchDesignSystem with a broken instance", () => {
  test("skips an instance whose main component cannot be read, keeping every other hit", async () => {
    const card: SearchableNode = { id: "11:1", name: "Card", type: "COMPONENT" };
    const broken: SearchableNode = {
      id: "30:9",
      name: "Card copy",
      type: "INSTANCE",
      getMainComponentAsync: async () => {
        throw new Error("The main component of this instance could not be loaded");
      },
    };
    const result = await searchDesignSystem("card", {
      nodes: [card, broken],
      readTeamLibrary: stubTeamLibrary(),
    });
    expect(result.results.map((hit) => hit.id)).toEqual(["11:1"]);
  });
});
