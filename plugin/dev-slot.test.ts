import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FIRST_SLOT_PORT,
  LAST_SLOT_PORT,
  SLOT_FILE,
  devManifest,
  parseDevSlot,
  pickSlotPort,
  readDevSlot,
  slotNameFromBranch,
} from "./dev-slot";
import baseManifest from "./manifest.json";

describe("parseDevSlot", () => {
  test("accepts a name and a port inside the slot range", () => {
    expect(parseDevSlot('{"name":"cross-file-search","port":1996}', "x")).toEqual({
      name: "cross-file-search",
      port: 1996,
    });
  });

  test("refuses the stable port and ports outside the range", () => {
    expect(() => parseDevSlot('{"name":"a","port":1994}', "x")).toThrow(/between 1995 and 2019/);
    expect(() => parseDevSlot('{"name":"a","port":2020}', "x")).toThrow(/between 1995 and 2019/);
    expect(() => parseDevSlot('{"name":"a","port":"1996"}', "x")).toThrow(/between 1995 and 2019/);
  });

  test("refuses names that would not make a clean plugin id", () => {
    expect(() => parseDevSlot('{"name":"Has Space","port":1996}', "x")).toThrow(/name/);
    expect(() => parseDevSlot('{"name":"","port":1996}', "x")).toThrow(/name/);
  });

  test("names the file when it is not JSON", () => {
    expect(() => parseDevSlot("{", "/w/.dev-slot.json")).toThrow(/\/w\/\.dev-slot\.json/);
  });
});

describe("readDevSlot", () => {
  test("returns null when the checkout has no slot file — the stable build", () => {
    expect(readDevSlot(mkdtempSync(join(tmpdir(), "slot-")))).toBeNull();
  });

  test("reads the slot file at the checkout root", () => {
    const root = mkdtempSync(join(tmpdir(), "slot-"));
    writeFileSync(join(root, SLOT_FILE), '{"name":"diagrams","port":1997}\n');
    expect(readDevSlot(root)).toEqual({ name: "diagrams", port: 1997 });
  });
});

describe("slotNameFromBranch", () => {
  test("drops the branch-type prefix", () => {
    expect(slotNameFromBranch("feat/cross-file-search")).toBe("cross-file-search");
    expect(slotNameFromBranch("fix/connector-labels")).toBe("connector-labels");
  });

  test("folds anything else into lowercase dashes", () => {
    expect(slotNameFromBranch("feat/Phase_7 Motion")).toBe("phase-7-motion");
    expect(slotNameFromBranch("feat/a/b")).toBe("a-b");
  });
});

describe("pickSlotPort", () => {
  test("takes the lowest free port from 1995", () => {
    expect(pickSlotPort([])).toBe(FIRST_SLOT_PORT);
    expect(pickSlotPort([1995, 1997])).toBe(1996);
  });

  test("refuses when every slot is taken", () => {
    const all = Array.from(
      { length: LAST_SLOT_PORT - FIRST_SLOT_PORT + 1 },
      (_, i) => FIRST_SLOT_PORT + i
    );
    expect(() => pickSlotPort(all)).toThrow(/git worktree remove/);
  });
});

describe("devManifest", () => {
  const manifest = devManifest(baseManifest, { name: "diagrams", port: 1997 });

  test("gives the dev plugin its own name and id", () => {
    expect(manifest.name).toBe("Figma Design Relay (Dev: diagrams)");
    expect(manifest.id).toBe("figma-design-relay-dev-diagrams");
  });

  test("allows only the slot's port, never the stable 1994", () => {
    expect(manifest.networkAccess.allowedDomains).toEqual(["ws://localhost:1997"]);
  });

  test("points main and ui at files beside it in dist/", () => {
    expect(manifest.main).toBe("code.js");
    expect(manifest.ui).toBe("index.html");
  });

  test("keeps everything else from the stable manifest", () => {
    expect(manifest.permissions).toEqual(baseManifest.permissions);
    expect(manifest.editorType).toEqual(baseManifest.editorType);
    expect(manifest.documentAccess).toBe(baseManifest.documentAccess);
    expect(manifest.networkAccess.reasoning).toBe(baseManifest.networkAccess.reasoning);
  });
});
