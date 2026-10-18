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

  test("removes the other invisible characters: joiners, separators, soft hyphen, Arabic mark", () => {
    expect(cleanAgentName(`a${ch(0x2060)}b${ch(0x2064)}c`)).toBe("abc");
    expect(cleanAgentName(`line${ch(0x2028)}para${ch(0x2029)}`)).toBe("linepara");
    expect(cleanAgentName(`soft${ch(0x00ad)}hyphen`)).toBe("softhyphen");
    expect(cleanAgentName(`ar${ch(0x061c)}m`)).toBe("arm");
  });

  test("keeps the visible characters next to the 2028–202E and 2060–2069 ranges", () => {
    // U+202F (narrow no-break space) follows 2028–202E; U+205F (medium math space) precedes 2060.
    expect(cleanAgentName(`a${ch(0x202f)}b`)).toBe(`a${ch(0x202f)}b`);
    expect(cleanAgentName(`a${ch(0x205f)}b`)).toBe(`a${ch(0x205f)}b`);
  });

  test("never splits a character made of two code units", () => {
    const name = "a".repeat(63) + ch(0x1f600);
    expect(cleanAgentName(name)).toBe(name);
    expect(cleanAgentName("a".repeat(64) + ch(0x1f600))).toBe("a".repeat(64));
  });
});
