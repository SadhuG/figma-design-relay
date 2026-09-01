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
