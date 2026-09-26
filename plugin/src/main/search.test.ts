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

  test("matches a query in a non-Latin script", () => {
    expect(matchesQuery("ボタン", "ボタン/Primary")).toBe(true);
    expect(matchesQuery("ボタン", "Card")).toBe(false);
  });

  test("keeps accented letters rather than dropping them", () => {
    expect(matchesQuery("botón", "Botón/Primario")).toBe(true);
    expect(matchesQuery("botn", "Botón/Primario")).toBe(false);
  });

  test("matches a decomposed accent against a composed one", () => {
    expect(matchesQuery("botón", "Botón")).toBe(true);
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

  test("scores a full path query as an exact match", () => {
    expect(rankResults("button/primary", candidates)[0]).toMatchObject({
      name: "Button/Primary",
      score: 1,
    });
  });

  test("ranks a whole word above a bare substring", () => {
    const hits = rankResults("button", [
      { id: "2:1", name: "Iconbuttonish", kind: "component" },
      { id: "2:2", name: "Icon Button", kind: "component" },
    ]);
    expect(hits.map((hit) => [hit.name, hit.score])).toEqual([
      ["Icon Button", 0.9],
      ["Iconbuttonish", 0.5],
    ]);
  });

  test("ranks a word prefix above a bare substring", () => {
    const hits = rankResults("butt", [
      { id: "2:1", name: "Rebutton", kind: "component" },
      { id: "2:2", name: "Icon Button", kind: "component" },
    ]);
    expect(hits.map((hit) => [hit.name, hit.score])).toEqual([
      ["Icon Button", 0.7],
      ["Rebutton", 0.5],
    ]);
  });

  test("ranks a non-Latin exact segment first", () => {
    const hits = rankResults("ボタン", [
      { id: "3:1", name: "大きいボタン", kind: "component" },
      { id: "3:2", name: "ボタン", kind: "component" },
    ]);
    expect(hits.map((hit) => hit.id)).toEqual(["3:2", "3:1"]);
  });

  test("keeps the kind so the caller knows what it found", () => {
    const hit = rankResults("color", candidates)[0];
    expect(hit.kind).toBe("variableCollection");
  });
});
