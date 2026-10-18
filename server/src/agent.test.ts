import { describe, expect, test } from "bun:test";
import { AGENT_NAME_MAX, cleanAgentName } from "./agent.js";

// Built from code points so the test source holds no invisible characters.
const ch = (code: number) => String.fromCodePoint(code);

describe("cleanAgentName", () => {
  test("keeps a plain name", () => expect(cleanAgentName("claude-code")).toBe("claude-code"));

  test("trims whitespace", () => expect(cleanAgentName("  Cursor  ")).toBe("Cursor"));

  test("drops empty and non-string values", () => {
    for (const raw of ["", "   ", 42, {}, undefined, null]) {
      expect(cleanAgentName(raw)).toBeUndefined();
    }
  });

  test("removes control characters", () => {
    expect(cleanAgentName(`claude${ch(0x0a)}code`)).toBe("claudecode");
    expect(cleanAgentName(`a${ch(0x00)}b${ch(0x7f)}c`)).toBe("abc");
  });

  test("cuts long names", () => {
    expect(cleanAgentName("x".repeat(200))).toBe("x".repeat(AGENT_NAME_MAX));
    expect(AGENT_NAME_MAX).toBe(64);
  });
});

describe("cleanAgentName against display tricks", () => {
  test("removes C1 controls, bidi overrides and zero-width characters", () => {
    expect(cleanAgentName(`a${ch(0x85)}b`)).toBe("ab");
    expect(cleanAgentName(`evil${ch(0x202e)}edoc`)).toBe("eviledoc");
    expect(cleanAgentName(`x${ch(0x2066)}y${ch(0x2069)}`)).toBe("xy");
    expect(cleanAgentName(`zero${ch(0x200b)}width${ch(0x200f)}`)).toBe("zerowidth");
    expect(cleanAgentName(`${ch(0xfeff)}bom`)).toBe("bom");
  });

  test("never splits a character made of two code units", () => {
    const name = "a".repeat(63) + ch(0x1f600);
    expect(cleanAgentName(name)).toBe(name);
    expect(cleanAgentName("a".repeat(64) + ch(0x1f600))).toBe("a".repeat(64));
  });
});
