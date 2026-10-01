import { afterAll, beforeAll, expect, test } from "bun:test";

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
  async getNodeByIdAsync() {
    return page;
  },
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
