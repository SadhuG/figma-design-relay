import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";

const previousFigma = globalThis.figma;
const previousHtml = (globalThis as any).__html__;
const messages: any[] = [];
let loaded = false;
const page = {
  id: "2:0",
  type: "PAGE",
  name: "Other page",
  get children() {
    if (!loaded) throw new Error("Cannot access children before loadAsync");
    return [];
  },
  async loadAsync() {
    loaded = true;
  },
};
const api: any = {
  editorType: "figma",
  fileKey: "test",
  root: { name: "Test", children: [page] },
  currentPage: { selection: [] },
  on() {},
  showUI() {},
  ui: {
    postMessage(message: any) {
      messages.push(message);
    },
    resize() {},
    show() {},
  },
  clientStorage: {
    async getAsync() {
      return false;
    },
  },
  async getNodeByIdAsync(id: string) {
    return nodes.get(id) ?? page;
  },
};
/** Per-test node lookups; anything not listed resolves to `page`. */
const nodes = new Map<string, any>();
/** Keys a test added to `api`, removed again after it. */
const restore: string[] = [];
const stub = (key: string, value: unknown) => {
  restore.push(key);
  api[key] = value;
};
afterEach(() => {
  nodes.clear();
  api.editorType = "figma";
  for (const key of restore) delete api[key];
  restore.length = 0;
});
const dispatch = async (type: string, nodeIds?: string[], params?: Record<string, unknown>) => {
  messages.length = 0;
  const requestId = `${type}-${Math.random()}`;
  await api.ui.onmessage({ type: "server-request", payload: { type, requestId, nodeIds, params } });
  return messages.find((message) => message.requestId === requestId);
};
beforeAll(async () => {
  globalThis.figma = api;
  (globalThis as any).__html__ = "";
  await import("./code");
});
afterAll(() => {
  globalThis.figma = previousFigma;
  (globalThis as any).__html__ = previousHtml;
});
test("get_node loads a noncurrent page before serializing children", async () => {
  loaded = false;
  messages.length = 0;
  await api.ui.onmessage({
    type: "server-request",
    payload: {
      type: "get_node",
      requestId: "page",
      nodeIds: ["2:0"],
    },
  });
  const response = messages.find((message) => message.requestId === "page");
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({ id: "2:0", children: [] });
});
test("UI mount requests recover file status after a missed startup broadcast", async () => {
  messages.length = 0;
  await api.ui.onmessage({ type: "request-ui-state" });
  expect(messages.find((message) => message.type === "plugin-status")?.payload).toMatchObject({
    fileKey: "test",
    fileName: "Test",
    selectionCount: 0,
  });
});

/** A FigJam text sublayer: characters only change once its font is loaded. */
const textSublayer = (characters: string) => {
  const sublayer: any = {
    characters,
    fontName: { family: "Inter", style: "Medium" },
    getRangeAllFontNames: () => [{ family: "Inter", style: "Medium" }],
  };
  return sublayer;
};

test("set_text_content edits a sticky's text sublayer and reports the sticky", async () => {
  api.editorType = "figjam";
  const sticky = { id: "5:1", name: "Note", type: "STICKY", text: textSublayer("old") };
  nodes.set("5:1", sticky);
  const loaded: unknown[] = [];
  stub("loadFontAsync", async (font: unknown) => {
    loaded.push(font);
  });
  const response = await dispatch("set_text_content", ["5:1"], { text: "new" });
  expect(response.error).toBeUndefined();
  expect(sticky.text.characters).toBe("new");
  expect(response.data).toMatchObject({ nodeId: "5:1", nodeName: "Note", characters: "new" });
  expect(loaded).toEqual([{ family: "Inter", style: "Medium" }]);
});

test("FigJam get_styles keeps working categories when one style API is unavailable", async () => {
  api.editorType = "figjam";
  let gridCalled = false;
  stub("getLocalPaintStylesAsync", async () => [{ id: "S:1", name: "Brand", paints: [] }]);
  stub("getLocalTextStylesAsync", async () => {
    throw new Error("not available in FigJam");
  });
  stub("getLocalEffectStylesAsync", async () => []);
  stub("getLocalGridStylesAsync", async () => {
    gridCalled = true;
    throw new Error("not available in FigJam");
  });
  const response = await dispatch("get_styles");
  expect(response.error).toBeUndefined();
  expect(response.data.paints).toEqual([{ id: "S:1", name: "Brand", paints: [] }]);
  expect(response.data.text).toEqual([]);
  expect(response.data.effects).toEqual([]);
  expect(response.data.grids).toEqual([]);
  expect(gridCalled).toBe(false);
  expect(response.data.notes.join(" ")).toMatch(/text/);
});

test("FigJam get_variable_defs reports unavailable variables with a note", async () => {
  api.editorType = "figjam";
  stub("variables", {
    async getLocalVariableCollectionsAsync() {
      throw new Error("variables are not supported");
    },
  });
  const response = await dispatch("get_variable_defs");
  expect(response.error).toBeUndefined();
  expect(response.data.collections).toEqual([]);
  expect(typeof response.data.note).toBe("string");
});
