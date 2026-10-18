import { describe, expect, test } from "bun:test";
import { formatSelection, relayAddress, relayPort, relayRowText } from "./panel-state";

describe("formatSelection", () => {
  test("zero", () => expect(formatSelection(0)).toBe("Nothing selected"));
  test("one", () => expect(formatSelection(1)).toBe("1 node"));
  test("many", () => expect(formatSelection(3)).toBe("3 nodes"));
});

describe("relayAddress", () => {
  test("keeps the connection type, drops the path", () =>
    expect(relayAddress("ws://localhost:1994/ws")).toBe("ws://localhost:1994"));
  test("dev slot port", () =>
    expect(relayAddress("ws://localhost:1999/ws")).toBe("ws://localhost:1999"));
  test("unparseable input comes back as is", () =>
    expect(relayAddress("not a url")).toBe("not a url"));
});

describe("relayPort", () => {
  test("reads the port", () => expect(relayPort("ws://localhost:1994/ws")).toBe("1994"));
  test("unparseable input gives an empty string", () => expect(relayPort("not a url")).toBe(""));
});

describe("relayRowText", () => {
  test("connected", () =>
    expect(relayRowText("ws://localhost:1994", true)).toBe("ws://localhost:1994"));
  test("disconnected", () =>
    expect(relayRowText("ws://localhost:1994", false)).toBe("ws://localhost:1994 (no answer)"));
});
