import { describe, expect, test } from "bun:test";
import { AGENT_NAME_MAX, cleanAgentName } from "./agent.js";

describe("cleanAgentName", () => {
  test("keeps a plain name", () => expect(cleanAgentName("claude-code")).toBe("claude-code"));

  test("trims whitespace", () => expect(cleanAgentName("  Cursor  ")).toBe("Cursor"));

  test("drops empty and non-string values", () => {
    for (const raw of ["", "   ", 42, {}, undefined, null]) {
      expect(cleanAgentName(raw)).toBeUndefined();
    }
  });

  test("removes control characters", () => {
    expect(cleanAgentName("claude\ncode")).toBe("claudecode");
    expect(cleanAgentName("a\u0000b\u007fc")).toBe("abc");
  });

  test("cuts long names", () => {
    expect(cleanAgentName("x".repeat(200))).toBe("x".repeat(AGENT_NAME_MAX));
    expect(AGENT_NAME_MAX).toBe(64);
  });
});
