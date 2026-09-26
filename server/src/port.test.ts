import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSlotPort, resolvePort } from "./port.js";

describe("resolvePort", () => {
  test("defaults to the stable 1994 with no variable and no slot", () => {
    expect(resolvePort(undefined, null)).toBe(1994);
  });

  test("a worktree's slot port replaces the default", () => {
    expect(resolvePort(undefined, 1996)).toBe(1996);
  });

  test("FIGMA_DESIGN_RELAY_PORT wins over the slot", () => {
    expect(resolvePort(" 2001 ", 1996)).toBe(2001);
  });

  test("an invalid variable is refused rather than falling back to 1994", () => {
    expect(() => resolvePort("abc", null)).toThrow(/Invalid FIGMA_DESIGN_RELAY_PORT "abc"/);
    expect(() => resolvePort("70000", 1996)).toThrow(/between 1 and 65535/);
  });
});

describe("readSlotPort", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "slot-"));

  test("null when there is no slot file — the stable checkout", () => {
    expect(readSlotPort(join(dir(), ".dev-slot.json"))).toBeNull();
  });

  test("reads the port from a slot file", () => {
    const file = join(dir(), ".dev-slot.json");
    writeFileSync(file, '{"name":"diagrams","port":1997}');
    expect(readSlotPort(file)).toBe(1997);
  });

  test("a broken slot file is refused, so a dev server never joins the stable relay", () => {
    const file = join(dir(), ".dev-slot.json");
    writeFileSync(file, '{"name":"diagrams"}');
    expect(() => readSlotPort(file)).toThrow(/\.dev-slot\.json/);
    writeFileSync(file, '{"name":"diagrams","port":1994}');
    expect(() => readSlotPort(file)).toThrow(/between 1995 and 2019/);
  });
});
