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
