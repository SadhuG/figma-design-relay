import { describe, expect, test } from "bun:test";
import { matchesQuery, rankResults } from "./search";

const candidates = [
  { name: "Button/Primary", kind: "component" as const, id: "1:1" },
  { name: "Button/Secondary", kind: "component" as const, id: "1:2" },
  { name: "Card", kind: "component" as const, id: "1:3" },
  { name: "color/button/bg", kind: "variableCollection" as const, id: "VC:1" },
];

describe("matchesQuery", () => {
  test("matches case-insensitively", () => {
    expect(matchesQuery("button", "Button/Primary")).toBe(true);
  });

  test("matches a path segment", () => {
    expect(matchesQuery("primary", "Button/Primary")).toBe(true);
  });

  test("ignores separators in the query", () => {
    expect(matchesQuery("button primary", "Button/Primary")).toBe(true);
  });

  test("does not match unrelated names", () => {
    expect(matchesQuery("button", "Card")).toBe(false);
  });
});

describe("rankResults", () => {
  test("ranks an exact segment match above a substring match", () => {
    const hits = rankResults("button", candidates);
    expect(hits[0].name.startsWith("Button")).toBe(true);
  });

  test("returns every match, not just the first", () => {
    expect(rankResults("button", candidates)).toHaveLength(3);
  });

  test("returns an empty list rather than a bad guess", () => {
    expect(rankResults("zzz", candidates)).toEqual([]);
  });

  test("keeps the kind so the caller knows what it found", () => {
    const hit = rankResults("color", candidates)[0];
    expect(hit.kind).toBe("variableCollection");
  });
});
