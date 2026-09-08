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
