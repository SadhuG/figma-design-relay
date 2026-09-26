import { describe, expect, test } from "bun:test";
import { validateRpc } from "./schema.js";

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

  test("rejects a sticky with no text", () => {
    expect(validateRpc("create_sticky", undefined, { x: 10 }).error).not.toBeNull();
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
