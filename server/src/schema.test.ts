import { describe, expect, test } from "bun:test";
import { validateRpc } from "./schema.js";

describe("validateRpc get_layout_tree", () => {
  test("retains the root and bounded budget on the follower hop", () => {
    const result = validateRpc("get_layout_tree", ["3:0"], { maxNodes: 2 });
    expect(result.error).toBeNull();
    expect(result.params).toMatchObject({ rootId: "3:0", maxNodes: 2 });
  });
  test("rejects invalid roots and budgets", () => {
    expect(validateRpc("get_layout_tree", ["3-0"]).error).toContain("colon format");
    expect(validateRpc("get_layout_tree").error).not.toBeNull();
    for (const maxNodes of [0, 10001, 1.5]) {
      expect(validateRpc("get_layout_tree", ["3:0"], { maxNodes }).error).not.toBeNull();
    }
  });
});

describe("validateRpc", () => {
  test("accepts a well-formed get_node request", () => {
    const result = validateRpc("get_node", ["4029:12345"]);
    expect(result.error).toBeNull();
  });

  test("rejects a hyphenated node id", () => {
    const result = validateRpc("get_node", ["4029-12345"]);
    expect(result.error).toContain("colon format");
  });

  test("passes through tools that have no schema", () => {
    const result = validateRpc("not_a_real_tool");
    expect(result.error).toBeNull();
  });
});

describe("validateRpc get_design_context", () => {
  // The node to describe travels as transport-level nodeIds, like every other
  // tool that names a node. validateRpc strips `nodeId` from params, so a
  // nodeId placed inside params would never reach the plugin from a follower.
  test("validates the node id carried on nodeIds", () => {
    const result = validateRpc("get_design_context", ["4029-12345"], { depth: 1 });
    expect(result.error).toContain("colon format");
  });

  test("forwards depth, format and assetDir untouched", () => {
    const result = validateRpc("get_design_context", ["4029:12345"], {
      depth: 3,
      format: "css",
      assetDir: "assets",
    });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ depth: 3, format: "css", assetDir: "assets" });
  });

  test("rejects an unknown format", () => {
    const result = validateRpc("get_design_context", undefined, { format: "vue" });
    expect(result.error).not.toBeNull();
  });
});

describe("validateRpc run_script", () => {
  test("accepts a script", () => {
    const result = validateRpc("run_script", undefined, { code: "return figma.root.name" });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ code: "return figma.root.name" });
  });

  test("rejects a missing script", () => {
    expect(validateRpc("run_script", undefined, {}).error).not.toBeNull();
  });

  test("rejects an empty script", () => {
    expect(validateRpc("run_script", undefined, { code: "" }).error).not.toBeNull();
  });

  test("rejects a script over the character cap", () => {
    const result = validateRpc("run_script", undefined, { code: "x".repeat(100_001) });
    expect(result.error).toContain("100000");
  });

  test("drops fileKey from the forwarded params", () => {
    const result = validateRpc("run_script", undefined, { code: "return 1", fileKey: "abc" });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ code: "return 1" });
  });
});

describe("validateRpc get_code_connect_map", () => {
  test("accepts node ids", () => {
    expect(validateRpc("get_code_connect_map", ["1:2"], {}).error).toBeNull();
  });

  test("rejects a hyphenated node id", () => {
    expect(validateRpc("get_code_connect_map", ["1-2"], {}).error).toMatch(/colon format/);
  });
});

describe("validateRpc get_context_for_code_connect", () => {
  test("validates the node id carried on nodeIds", () => {
    expect(validateRpc("get_context_for_code_connect", ["1-2"], {}).error).toMatch(/colon format/);
  });

  test("requires a node id", () => {
    expect(validateRpc("get_context_for_code_connect", undefined, {}).error).not.toBeNull();
  });
});

describe("validateRpc get_code_connect_suggestions", () => {
  test("requires at least one node id", () => {
    expect(validateRpc("get_code_connect_suggestions", [], {}).error).not.toBeNull();
  });

  test("accepts component ids", () => {
    expect(validateRpc("get_code_connect_suggestions", ["1:2"], {}).error).toBeNull();
  });
});

describe("validateRpc add_code_connect_map", () => {
  const params = { component: "Button", importPath: "./Button", file: "ui/Button.figma.tsx" };

  test("accepts a complete mapping", () => {
    expect(validateRpc("add_code_connect_map", ["1:2"], params).error).toBeNull();
  });

  test("requires the component name", () => {
    expect(
      validateRpc("add_code_connect_map", ["1:2"], { ...params, component: "" }).error
    ).not.toBeNull();
  });
});

describe("validateRpc add_code_connect_map figmaFileKey", () => {
  const params = { component: "Button", importPath: "./Button", file: "ui/Button.figma.tsx" };

  test("accepts the key from a Figma URL", () => {
    expect(
      validateRpc("add_code_connect_map", ["1:2"], { ...params, figmaFileKey: "AbC123" }).error
    ).toBeNull();
  });

  test("rejects a whole URL where the key belongs", () => {
    expect(
      validateRpc("add_code_connect_map", ["1:2"], {
        ...params,
        figmaFileKey: "https://www.figma.com/design/AbC123/DS",
      }).error
    ).not.toBeNull();
  });
});

describe("validateRpc add_code_connect_map component", () => {
  const params = { importPath: "./Button", file: "ui/Button.figma.tsx" };

  test("accepts a dotted identifier", () => {
    expect(
      validateRpc("add_code_connect_map", ["1:2"], { ...params, component: "Icons.Search" }).error
    ).toBeNull();
  });

  test("rejects a name that is not an identifier", () => {
    expect(
      validateRpc("add_code_connect_map", ["1:2"], { ...params, component: "my-button" }).error
    ).not.toBeNull();
  });
});

describe("validateRpc whoami", () => {
  test("accepts a bare call and forwards no params", () => {
    const result = validateRpc("whoami", undefined, { fileKey: "abc" });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({});
  });
});

describe("validateRpc get_libraries", () => {
  test("accepts a call with no collection key", () => {
    expect(validateRpc("get_libraries", undefined, {}).error).toBeNull();
  });

  test("forwards a collection key", () => {
    const result = validateRpc("get_libraries", undefined, { collectionKey: "abc123" });
    expect(result.params).toEqual({ collectionKey: "abc123" });
  });

  test("rejects an empty collection key", () => {
    expect(validateRpc("get_libraries", undefined, { collectionKey: "" }).error).not.toBeNull();
  });
});

describe("validateRpc import_library_asset", () => {
  test("forwards kind and key", () => {
    const result = validateRpc("import_library_asset", undefined, { kind: "style", key: "abc" });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ kind: "style", key: "abc" });
  });

  test("rejects an unknown kind", () => {
    expect(
      validateRpc("import_library_asset", undefined, { kind: "page", key: "abc" }).error
    ).not.toBeNull();
  });

  test("rejects an empty key", () => {
    expect(
      validateRpc("import_library_asset", undefined, { kind: "component", key: "" }).error
    ).not.toBeNull();
  });
});

describe("validateRpc search_design_system", () => {
  test("forwards the query", () => {
    const result = validateRpc("search_design_system", undefined, { query: "button" });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ query: "button" });
  });

  test("rejects a blank query", () => {
    expect(validateRpc("search_design_system", undefined, { query: "  " }).error).not.toBeNull();
  });

  test("forwards a limit", () => {
    const result = validateRpc("search_design_system", undefined, { query: "button", limit: 5 });
    expect(result.params).toEqual({ query: "button", limit: 5 });
  });

  test("forwards allPages", () => {
    const result = validateRpc("search_design_system", undefined, {
      query: "button",
      allPages: true,
    });
    expect(result.params).toEqual({ query: "button", allPages: true });
  });

  test("rejects a non-boolean allPages", () => {
    expect(
      validateRpc("search_design_system", undefined, { query: "button", allPages: "yes" }).error
    ).toMatch(/allPages/);
  });

  test("forwards files", () => {
    const result = validateRpc("search_design_system", undefined, {
      query: "button",
      files: ["Acme"],
    });
    expect(result.params).toEqual({ query: "button", files: ["Acme"] });
  });

  test.each([[[]], [[""]], [Array.from({ length: 21 }, (_, i) => `f${i}`)]])(
    "rejects files of %p",
    (files) => {
      expect(
        validateRpc("search_design_system", undefined, { query: "button", files }).error
      ).toMatch(/files/);
    }
  );

  test.each([0, 201, 2.5])("rejects a limit of %p", (limit) => {
    expect(
      validateRpc("search_design_system", undefined, { query: "button", limit }).error
    ).toMatch(/limit/);
  });
});

// Phase 6: the FigJam write surface. Each tool validates on the follower hop
// exactly as a design write does, so a bad call fails before it reaches Figma.
describe("validateRpc create_sticky", () => {
  test("forwards text and position", () => {
    const result = validateRpc("create_sticky", undefined, { text: "Ship it", x: 10, y: 20 });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ text: "Ship it", x: 10, y: 20 });
  });

  // Since 0.7.9 an omitted label means an empty sticky, as upstream creates it.
  test("a sticky with no text gets an empty label", () => {
    expect(validateRpc("create_sticky", undefined, { x: 10 }).params).toEqual({ text: "", x: 10 });
  });

  test("rejects a label that is not text", () => {
    expect(validateRpc("create_sticky", undefined, { text: 5 }).error).not.toBeNull();
  });
});

describe("validateRpc create_shape_with_text", () => {
  test("accepts any FigJam shape, including the engineering ones", () => {
    const result = validateRpc("create_shape_with_text", undefined, {
      text: "DB",
      shapeType: "ENG_DATABASE",
    });
    expect(result.error).toBeNull();
  });

  test("rejects a design-file shape name", () => {
    expect(
      validateRpc("create_shape_with_text", undefined, { text: "x", shapeType: "RECTANGLE" }).error
    ).not.toBeNull();
  });

  test("rejects a non-positive size", () => {
    expect(
      validateRpc("create_shape_with_text", undefined, { text: "x", width: 0, height: 40 }).error
    ).not.toBeNull();
  });
});

describe("validateRpc create_connector", () => {
  test("keeps both endpoint ids through the follower hop", () => {
    const result = validateRpc("create_connector", undefined, {
      startNodeId: "1:2",
      endNodeId: "1:3",
      text: "then",
    });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ startNodeId: "1:2", endNodeId: "1:3", text: "then" });
  });

  test("rejects a hyphenated endpoint id", () => {
    expect(
      validateRpc("create_connector", undefined, { startNodeId: "1-2", endNodeId: "1:3" }).error
    ).toContain("colon format");
  });

  test("rejects a connector with one end", () => {
    expect(validateRpc("create_connector", undefined, { startNodeId: "1:2" }).error).not.toBeNull();
  });
});

describe("validateRpc create_section", () => {
  test("accepts an empty request, since every field is optional", () => {
    expect(validateRpc("create_section", undefined, {}).error).toBeNull();
  });

  test("rejects a width without a height", () => {
    expect(validateRpc("create_section", undefined, { width: 400 }).error).not.toBeNull();
  });
});

describe("validateRpc generate_diagram", () => {
  test("forwards the Mermaid source", () => {
    const result = validateRpc("generate_diagram", undefined, {
      mermaid: "flowchart TD\n A --> B",
    });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ mermaid: "flowchart TD\n A --> B" });
  });

  test("rejects empty source", () => {
    expect(validateRpc("generate_diagram", undefined, { mermaid: "" }).error).not.toBeNull();
  });
});

describe("upstream relay contracts", () => {
  test("get_node keeps includePrototype across the follower hop", () => {
    expect(validateRpc("get_node", ["1:2"], { includePrototype: true }).params).toEqual({
      includePrototype: true,
    });
  });

  test("a set_node_properties batch forwards only the property patch", () => {
    expect(validateRpc("set_node_properties", ["1:2", "1:3"], { visible: false }).params).toEqual({
      visible: false,
    });
  });

  test("a connector may run between two free coordinates", () => {
    expect(
      validateRpc("create_connector", undefined, {
        startX: 0,
        startY: 0,
        endX: 10,
        endY: 20,
        text: "go",
      }).error
    ).toBeNull();
  });

  test("a shape with text keeps its name and fill across the follower hop", () => {
    expect(
      validateRpc("create_shape_with_text", undefined, {
        text: "DB",
        name: "Database",
        fillHex: "#123456",
      }).params
    ).toMatchObject({ text: "DB", name: "Database", fillHex: "#123456" });
  });
});

describe("prototype read schemas", () => {
  test("bounds reject zero, fractions and one past the maximum", () => {
    for (const maxNodes of [0, 1.5, 50001]) {
      expect(validateRpc("get_prototype_connections", ["1:2"], { maxNodes }).error).not.toBeNull();
    }
    for (const maxScreens of [0, 2.5, 501]) {
      expect(validateRpc("trace_prototype_flow", ["1:2"], { maxScreens }).error).not.toBeNull();
    }
    for (const maxNodesPerScreen of [0, 0.5, 50001]) {
      expect(
        validateRpc("trace_prototype_flow", ["1:2"], { maxNodesPerScreen }).error
      ).not.toBeNull();
    }
  });

  test("the maximums themselves are accepted", () => {
    expect(validateRpc("get_prototype_connections", ["1:2"], { maxNodes: 50000 }).error).toBeNull();
    expect(
      validateRpc("trace_prototype_flow", ["1:2"], { maxScreens: 500, maxNodesPerScreen: 50000 })
        .error
    ).toBeNull();
  });

  test("a scan root is optional but a trace start is required", () => {
    expect(validateRpc("get_prototype_connections", undefined, {}).error).toBeNull();
    expect(validateRpc("trace_prototype_flow", undefined, {}).error).not.toBeNull();
  });

  test("instance-child ids are accepted and options forwarded without them", () => {
    const result = validateRpc("trace_prototype_flow", ["I1:2;3:4"], { maxScreens: 3 });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ maxScreens: 3 });
  });
});

describe("layout helper schemas", () => {
  test("distribution needs three ids", () => {
    expect(validateRpc("distribute_horizontally", ["1:1", "1:2"]).error).not.toBeNull();
    expect(validateRpc("distribute_vertically", ["1:1", "1:2", "I1:3;4:5"]).error).toBeNull();
  });

  test("grid size must be positive; padding and gap must not be negative", () => {
    expect(validateRpc("align_to_grid", ["1:1"], { gridSize: 0 }).error).not.toBeNull();
    expect(validateRpc("align_to_grid", ["1:1"], { gridSize: 0.5 }).error).toBeNull();
    expect(validateRpc("fit_to_content", ["1:1"], { padding: -1 }).error).not.toBeNull();
    expect(
      validateRpc("place_below", ["1:1"], { relativeToId: "1:2", gap: -1 }).error
    ).not.toBeNull();
  });

  test("relative placement needs a valid reference and a known alignment", () => {
    expect(validateRpc("place_right_of", ["1:1"], {}).error).not.toBeNull();
    expect(validateRpc("place_right_of", ["1:1"], { relativeToId: "1-2" }).error).not.toBeNull();
    expect(
      validateRpc("place_right_of", ["1:1"], { relativeToId: "1:2", align: "end" }).error
    ).not.toBeNull();
  });

  test("duplicate offsets are required numbers", () => {
    expect(validateRpc("duplicate_with_offset", ["1:1"], { offsetX: 1 }).error).not.toBeNull();
    expect(
      validateRpc("duplicate_with_offset", ["1:1"], { offsetX: 1, offsetY: "2" }).error
    ).not.toBeNull();
  });
});

describe("FigJam creator extensions", () => {
  const params = (tool: string, input: Record<string, unknown>) =>
    validateRpc(tool, undefined, input);

  test("text wins over characters; characters alone and no label normalise onto text", () => {
    for (const tool of ["create_sticky", "create_shape_with_text"]) {
      expect(params(tool, { text: "a", characters: "b" }).params).toMatchObject({ text: "a" });
      expect(params(tool, { characters: "b" }).params).toMatchObject({ text: "b" });
      expect(params(tool, {}).params).toMatchObject({ text: "" });
      expect(params(tool, { text: "" }).params).toMatchObject({ text: "" });
      expect(params(tool, { characters: "b" }).params).not.toHaveProperty("characters");
    }
  });

  test("the old shape call still validates, and a lone width is still refused", () => {
    expect(params("create_shape_with_text", { text: "DB" }).error).toBeNull();
    expect(params("create_shape_with_text", { text: "DB", width: 10 }).error).toContain("together");
    expect(params("create_section", { width: 10 }).error).toContain("together");
  });

  test("sticky placement and width survive the follower hop", () => {
    expect(
      params("create_sticky", {
        text: "hi",
        name: "Idea",
        parentId: "1:2",
        isWideWidth: true,
        x: 1,
        y: 2,
        bogus: 1,
      }).params
    ).toEqual({ text: "hi", name: "Idea", parentId: "1:2", isWideWidth: true, x: 1, y: 2 });
  });

  test("shape styling survives the follower hop", () => {
    const styled = {
      text: "DB",
      shapeType: "ENG_DATABASE",
      name: "Store",
      parentId: "1:2",
      fontFamily: "Inter",
      fontStyle: "Bold",
      fontSize: 18,
      rotation: 15,
      fillHex: "#112233",
      fillOpacity: 0.5,
      strokeHex: "#445566",
      strokeOpacity: 0.25,
      strokeWeight: 2,
      textFillHex: "#ffffff",
      textFillOpacity: 0.9,
    };
    expect(params("create_shape_with_text", styled).params).toEqual(styled);
  });

  test("an opacity needs its colour", () => {
    for (const [tool, key] of [
      ["create_shape_with_text", "fillOpacity"],
      ["create_shape_with_text", "strokeOpacity"],
      ["create_shape_with_text", "textFillOpacity"],
      ["create_section", "fillOpacity"],
    ]) {
      expect(params(tool, { [key]: 0.5 }).error, `${tool} ${key}`).not.toBeNull();
    }
  });

  test("section parent, fill and hidden contents survive the follower hop", () => {
    const section = {
      name: "Area",
      parentId: "1:2",
      fillHex: "#eeeeee",
      fillOpacity: 0.3,
      sectionContentsHidden: true,
    };
    expect(params("create_section", section).params).toEqual(section);
  });

  test("each connector end is a node id or a full coordinate, never both or half", () => {
    const ok = (input: Record<string, unknown>) => params("create_connector", input).error;
    expect(ok({ startNodeId: "1:1", endNodeId: "1:2" })).toBeNull();
    expect(ok({ startX: 0, startY: 0, endNodeId: "1:2", endAnchor: "top" })).toBeNull();
    expect(ok({ startNodeId: "1:1", startAnchor: "left", endX: 3, endY: 4 })).toBeNull();
    expect(ok({ startX: 0, endNodeId: "1:2" })).toMatch(/start/);
    expect(ok({ startNodeId: "1:1", startX: 0, startY: 0, endNodeId: "1:2" })).toMatch(/start/);
    expect(ok({ startNodeId: "1:1", endX: 1, endY: 2, endAnchor: "top" })).toMatch(/endAnchor/);
    expect(ok({ startNodeId: "1:1", endNodeId: "1:2", endAnchor: "middle" })).not.toBeNull();
  });

  test("connector label, name, parent and stroke survive the follower hop", () => {
    const connector = {
      startNodeId: "1:1",
      endX: 10,
      endY: 20,
      text: "yes",
      name: "Edge",
      parentId: "1:9",
      strokeWeight: 3,
      strokeHex: "#000000",
      startAnchor: "bottom",
    };
    expect(params("create_connector", connector).params).toEqual(connector);
  });
});
