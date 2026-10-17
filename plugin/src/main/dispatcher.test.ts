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
    return nodes.has(id) ? nodes.get(id) : page;
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
  expect(response.data.notes.join(" ")).toMatch(/\btext styles\b/i);
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

/** A screen on the loaded current page with one navigating button. */
const prototypeFixture = () => {
  const current: any = { id: "1:0", name: "Page 1", type: "PAGE", flowStartingPoints: [] };
  current.loadAsync = async () => {};
  const screen: any = { id: "1:1", name: "Home", type: "FRAME", parent: current, reactions: [] };
  const button: any = {
    id: "1:2",
    name: "Go",
    type: "FRAME",
    parent: screen,
    reactions: [
      {
        trigger: { type: "ON_CLICK" },
        actions: [{ type: "NODE", destinationId: "1:3", navigation: "NAVIGATE" }],
      },
    ],
  };
  const next: any = { id: "1:3", name: "Next", type: "FRAME", parent: current, reactions: [] };
  screen.children = [button];
  current.children = [screen, next];
  for (const node of [current, screen, button, next]) nodes.set(node.id, node);
  stub("variables", {
    getVariableByIdAsync: async () => null,
    getVariableCollectionByIdAsync: async () => null,
  });
  return { current, screen, button, next };
};

test("get_node with includePrototype adds the awaited serialization plus a scan", async () => {
  const { screen } = prototypeFixture();
  const response = await dispatch("get_node", ["1:1"], { includePrototype: true });
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({ id: "1:1", name: "Home" });
  expect(response.data.prototype).toMatchObject({ root: { id: "1:1" }, nodesScanned: 2 });
  expect(response.data.prototype.connections[0]).toMatchObject({ id: "1:2", name: "Go" });
  expect(typeof response.data.then).toBe("undefined");
  expect(screen.id).toBe("1:1");
});

test("get_node includePrototype is refused in FigJam while plain get_node still works", async () => {
  prototypeFixture();
  api.editorType = "figjam";
  const refused = await dispatch("get_node", ["1:1"], { includePrototype: true });
  expect(refused.error).toMatch(/^get_node includePrototype requires design editor or Dev Mode/);
  const plain = await dispatch("get_node", ["1:1"]);
  expect(plain.error).toBeUndefined();
  expect(plain.data).toMatchObject({ id: "1:1" });
});

test("get_prototype_connections scans the given root and reports file details", async () => {
  prototypeFixture();
  const response = await dispatch("get_prototype_connections", ["1:1"], { maxNodes: 1 });
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({
    schemaVersion: 1,
    fileName: "Test",
    root: { id: "1:1" },
    nodesScanned: 1,
    truncated: true,
  });
});

test("get_prototype_connections without a root scans the current page", async () => {
  const { current } = prototypeFixture();
  const previous = api.currentPage;
  api.currentPage = current;
  try {
    const response = await dispatch("get_prototype_connections");
    expect(response.error).toBeUndefined();
    expect(response.data.root).toEqual({ id: "1:0", name: "Page 1", type: "PAGE" });
  } finally {
    api.currentPage = previous;
  }
});

test("trace_prototype_flow follows navigation from the given screen", async () => {
  prototypeFixture();
  const response = await dispatch("trace_prototype_flow", ["1:2"], { maxScreens: 5 });
  expect(response.error).toBeUndefined();
  expect(response.data.screens.map((s: any) => s.name)).toEqual(["Home", "Next"]);
});

test("prototype reads say what to do when the node does not exist", async () => {
  prototypeFixture();
  nodes.set("9:9", null);
  const response = await dispatch("trace_prototype_flow", ["9:9"]);
  expect(response.error).toMatch(/9:9 not found/);
});

test("prototype tools are refused in Slides before any lookup", async () => {
  prototypeFixture();
  api.editorType = "slides";
  const response = await dispatch("get_prototype_connections", ["1:1"]);
  expect(response.error).toMatch(/no prototypes/);
});

test("set_auto_layout refuses a section with a reason, leaving it unchanged", async () => {
  const section: any = { id: "3:1", name: "Area", type: "SECTION", layoutMode: undefined };
  nodes.set("3:1", section);
  const response = await dispatch("set_auto_layout", ["3:1"], { layoutMode: "VERTICAL" });
  expect(response.error).toMatch(/section/i);
  expect(section.layoutMode).toBeUndefined();
});

test("create_svg builds editable layers through the helper in a design file", async () => {
  const frame: any = {
    id: "9:1",
    name: "Svg",
    type: "FRAME",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: { id: "0:1" },
    children: [{}],
    removed: false,
    remove() {},
    resize(w: number, h: number) {
      frame.width = w;
      frame.height = h;
    },
  };
  stub("createNodeFromSvg", (svg: string) => {
    expect(svg).toBe("<svg/>");
    return frame;
  });
  const response = await dispatch("create_svg", undefined, { svgText: "<svg/>", width: 30 });
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({ nodeId: "9:1", nodeType: "FRAME", width: 30, height: 10 });
});

test("create_svg is refused in FigJam before anything is created", async () => {
  api.editorType = "figjam";
  let created = false;
  stub("createNodeFromSvg", () => {
    created = true;
  });
  const response = await dispatch("create_svg", undefined, { svgText: "<svg/>" });
  expect(response.error).toMatch(/^create_svg requires design editor/);
  expect(created).toBe(false);
});

/** A free-positioned node for property and layout batches. */
const box = (id: string, overrides: Record<string, unknown> = {}): any => {
  const node: any = {
    id,
    name: `Box ${id}`,
    type: "RECTANGLE",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    visible: true,
    cornerRadius: 0,
    resize(width: number, height: number) {
      node.width = width;
      node.height = height;
    },
    ...overrides,
  };
  nodes.set(id, node);
  return node;
};

test("set_node_properties keeps the singleton result for one node", async () => {
  box("4:1");
  const response = await dispatch("set_node_properties", ["4:1"], { visible: false });
  expect(response.error).toBeUndefined();
  expect(response.data).toEqual({
    nodeId: "4:1",
    nodeName: "Box 4:1",
    applied: { visible: false },
  });
});

test("set_node_properties updates every node in a batch", async () => {
  const a = box("4:1");
  const b = box("4:2");
  const response = await dispatch("set_node_properties", ["4:1", "4:2"], { opacity: 0.5 });
  expect(response.error).toBeUndefined();
  expect(response.data.updatedCount).toBe(2);
  expect(response.data.results.map((r: any) => r.nodeId)).toEqual(["4:1", "4:2"]);
  expect([a.opacity, b.opacity]).toEqual([0.5, 0.5]);
});

test("set_node_properties applies a repeated id once, in first-seen order", async () => {
  box("4:1");
  box("4:2");
  const response = await dispatch("set_node_properties", ["4:2", "4:1", "4:2"], { x: 3 });
  expect(response.data.updatedCount).toBe(2);
  expect(response.data.results.map((r: any) => r.nodeId)).toEqual(["4:2", "4:1"]);
});

test("a missing second node leaves the first unchanged", async () => {
  const a = box("4:1");
  nodes.set("4:9", null);
  const response = await dispatch("set_node_properties", ["4:1", "4:9"], { x: 50 });
  expect(response.error).toMatch(/4:9/);
  expect(a.x).toBe(0);
});

test("a read-only cornerRadius on a later node leaves the earlier one unchanged", async () => {
  const a = box("4:1");
  box("4:3", { type: "SHAPE_WITH_TEXT" });
  const response = await dispatch("set_node_properties", ["4:1", "4:3"], { cornerRadius: 6 });
  expect(response.error).toMatch(/cornerRadius/);
  expect(a.cornerRadius).toBe(0);
});

test("layout helpers reach the plugin by request type with transport ids", async () => {
  const parent: any = { id: "6:0", layoutMode: "NONE" };
  const a = box("6:1", { parent, x: 0 });
  const b = box("6:2", { parent, x: 50 });
  const response = await dispatch("place_right_of", ["6:1"], { relativeToId: "6:2", gap: 4 });
  expect(response.error).toBeUndefined();
  expect(response.data).toEqual({ nodeId: "6:1", nodeName: "Box 6:1", x: 64, y: 0 });
  expect([a.x, b.x]).toEqual([64, 50]);
});

test("layout helpers are refused in Dev Mode before any lookup", async () => {
  api.editorType = "dev";
  const a = box("6:1");
  const response = await dispatch("align_to_grid", ["6:1"], { gridSize: 7 });
  expect(response.error).toMatch(/Dev Mode is read-only/);
  expect(a.x).toBe(0);
});

/** A TEXT node whose writes are logged, with two fonts across its characters. */
const textNode = (id: string, log: string[]) => {
  const node: any = {
    id,
    name: `Text ${id}`,
    type: "TEXT",
    _characters: "ab",
    fontName: Symbol("mixed"),
    fontSize: 12,
    getRangeAllFontNames: () => [
      { family: "Inter", style: "Regular" },
      { family: "Inter", style: "Bold" },
    ],
    get characters() {
      return node._characters;
    },
    set characters(value: string) {
      log.push("characters");
      node._characters = value;
    },
  };
  nodes.set(id, node);
  return node;
};

test("set_text_content loads every font in mixed text before writing", async () => {
  const log: string[] = [];
  const node = textNode("7:1", log);
  stub("loadFontAsync", async (font: FontName) => {
    log.push(`load ${font.style}`);
  });
  const response = await dispatch("set_text_content", ["7:1"], { text: "new" });
  expect(response.error).toBeUndefined();
  expect(log).toEqual(["load Regular", "load Bold", "characters"]);
  expect(node.characters).toBe("new");
});

test("a font that fails to load leaves the text unchanged", async () => {
  const log: string[] = [];
  const node = textNode("7:1", log);
  stub("loadFontAsync", async () => {
    throw new Error("font missing");
  });
  const response = await dispatch("set_text_content", ["7:1"], { text: "new" });
  expect(response.error).toMatch(/font missing/);
  expect(node.characters).toBe("ab");
});

test("an unsupported sublayer property fails before any other property changes", async () => {
  api.editorType = "figjam";
  const text: any = {
    characters: "x",
    fontName: { family: "Inter", style: "Medium" },
    fontSize: 12,
    getRangeAllFontNames: () => [{ family: "Inter", style: "Medium" }],
  };
  nodes.set("7:2", { id: "7:2", name: "Note", type: "STICKY", text });
  stub("loadFontAsync", async () => {});
  const response = await dispatch("set_text_properties", ["7:2"], {
    fontSize: 30,
    textAlignHorizontal: "CENTER",
  });
  expect(response.error).toMatch(/textAlignHorizontal/);
  expect(text.fontSize).toBe(12);
});

test("set_text_properties styles a FigJam sticky's text and reports the sticky", async () => {
  api.editorType = "figjam";
  const text: any = {
    characters: "x",
    fontName: { family: "Inter", style: "Medium" },
    fontSize: 12,
    getRangeAllFontNames: () => [{ family: "Inter", style: "Medium" }],
  };
  nodes.set("7:2", { id: "7:2", name: "Note", type: "STICKY", text });
  stub("loadFontAsync", async () => {});
  const response = await dispatch("set_text_properties", ["7:2"], {
    fontSize: 30,
    fillHex: "#ff0000",
  });
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({ nodeId: "7:2", nodeName: "Note" });
  expect(text.fontSize).toBe(30);
  expect(text.fills[0].color).toEqual({ r: 1, g: 0, b: 0 });
});

test("Slides text content still edits while text styling stays refused", async () => {
  api.editorType = "slides";
  const node = textNode("7:1", []);
  stub("loadFontAsync", async () => {});
  const edited = await dispatch("set_text_content", ["7:1"], { text: "slide" });
  expect(edited.error).toBeUndefined();
  expect(node.characters).toBe("slide");
  const styled = await dispatch("set_text_properties", ["7:1"], { fontSize: 20 });
  expect(styled.error).toMatch(/Slides/);
});

test("Dev Mode refuses both text writes", async () => {
  api.editorType = "dev";
  textNode("7:1", []);
  for (const type of ["set_text_content", "set_text_properties"]) {
    const response = await dispatch(type, ["7:1"], { text: "x", fontSize: 3 });
    expect(response.error).toMatch(/Dev Mode is read-only/);
  }
});

test("FigJam get_variable_defs keeps serialized values when variables work", async () => {
  api.editorType = "figjam";
  stub("variables", {
    getLocalVariableCollectionsAsync: async () => [
      { id: "C:1", name: "Board", modes: [{ modeId: "m", name: "Default" }], variableIds: ["V:1"] },
    ],
    getVariableByIdAsync: async () => ({
      id: "V:1",
      name: "accent",
      resolvedType: "COLOR",
      valuesByMode: { m: { r: 1, g: 0, b: 0 } },
    }),
  });
  const response = await dispatch("get_variable_defs");
  expect(response.error).toBeUndefined();
  expect(response.data.note).toBeUndefined();
  expect(response.data.collections[0].variables[0].valuesByMode.m).toEqual({
    type: "COLOR",
    r: 1,
    g: 0,
    b: 0,
    a: 1,
  });
});

test("in a design file a failing style or variable API is still an error", async () => {
  stub("getLocalPaintStylesAsync", async () => []);
  stub("getLocalTextStylesAsync", async () => {
    throw new Error("text styles broke");
  });
  stub("getLocalEffectStylesAsync", async () => []);
  stub("getLocalGridStylesAsync", async () => []);
  expect((await dispatch("get_styles")).error).toMatch(/text styles broke/);
  stub("variables", {
    async getLocalVariableCollectionsAsync() {
      throw new Error("variables broke");
    },
  });
  expect((await dispatch("get_variable_defs")).error).toMatch(/variables broke/);
});

/** A FigJam board: a current page, a section on it, and fake creators that log. */
const board = () => {
  api.editorType = "figjam";
  const created: any[] = [];
  const page: any = { id: "8:0", name: "Board", type: "PAGE", children: [] as any[] };
  const container = (node: any) => {
    node.children = [];
    node.appendChild = (child: any) => {
      child.parent?.children?.splice(child.parent.children.indexOf(child), 1);
      node.children.push(child);
      child.parent = node;
    };
    return node;
  };
  container(page);
  page.loadAsync = async () => {};
  const section = container({
    id: "8:1",
    name: "Area",
    type: "SECTION",
    x: 100,
    y: 100,
    absoluteTransform: [
      [1, 0, 100],
      [0, 1, 100],
    ],
  });
  page.appendChild(section);
  for (const node of [page, section]) nodes.set(node.id, node);
  const previousPage = api.currentPage;
  api.currentPage = page;
  restoreCurrentPage = () => {
    api.currentPage = previousPage;
  };
  const textSublayer = () => ({
    characters: "",
    fontName: { family: "Inter", style: "Medium" },
    fontSize: 16,
    fills: [] as any[],
  });
  const base = (type: string, extra: Record<string, unknown> = {}) => {
    const node: any = {
      id: `n${created.length + 1}`,
      name: type,
      type,
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      removed: false,
      fills: [],
      strokes: [],
      remove() {
        node.removed = true;
        node.parent?.children?.splice(node.parent.children.indexOf(node), 1);
      },
      resize(w: number, h: number) {
        node.width = w;
        node.height = h;
      },
      ...extra,
    };
    created.push(node);
    page.appendChild(node);
    nodes.set(node.id, node);
    return node;
  };
  const fonts: string[] = [];
  stub("loadFontAsync", async (font: FontName) => {
    if (font.family === "") throw new Error("Cannot load an empty font");
    if (font.family === "Missing") throw new Error("font not found");
    fonts.push(`${font.family} ${font.style}`);
  });
  stub("createSticky", () => base("STICKY", { text: textSublayer(), isWideWidth: false }));
  stub("createShapeWithText", () =>
    base("SHAPE_WITH_TEXT", { text: textSublayer(), shapeType: "SQUARE" })
  );
  stub("createSection", () => {
    const node = base("SECTION", { sectionContentsHidden: false });
    node.resizeWithoutConstraints = (w: number, h: number) => {
      node.width = w;
      node.height = h;
    };
    return node;
  });
  stub("createConnector", () => {
    // A connector as FigJam makes it: the line type last used, and no label font.
    const connector = base("CONNECTOR", {
      connectorLineType: "STRAIGHT",
      text: { characters: "", fontName: { family: "", style: "" } },
      ends: [] as any[],
    });
    const assign = (end: any) => {
      if (
        "magnet" in end &&
        connector.connectorLineType === "STRAIGHT" &&
        !["CENTER", "NONE"].includes(end.magnet)
      ) {
        throw new Error("Straight connector endpoints may only use the CENTER or NONE magnets.");
      }
      connector.ends.push({ ...end, parentAtAssignment: connector.parent?.id });
    };
    Object.defineProperty(connector, "connectorStart", { set: assign });
    Object.defineProperty(connector, "connectorEnd", { set: assign });
    return connector;
  });
  return { page, section, created, fonts, base };
};
let restoreCurrentPage = () => {};
afterEach(() => {
  restoreCurrentPage();
  restoreCurrentPage = () => {};
});

test("create_sticky honours name, parent, wide width and text, positioned in its parent", async () => {
  const { section, fonts } = board();
  const response = await dispatch("create_sticky", undefined, {
    text: "Idea",
    name: "Note",
    parentId: "8:1",
    isWideWidth: true,
    x: 5,
    y: 6,
  });
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({
    type: "STICKY",
    nodeName: "Note",
    parentId: "8:1",
    x: 5,
    y: 6,
  });
  const sticky = section.children[0];
  expect([sticky.text.characters, sticky.isWideWidth]).toEqual(["Idea", true]);
  expect(fonts).toEqual(["Inter Medium"]);
});

test("a bad parent creates no sticky, shape, section or connector", async () => {
  const { created } = board();
  nodes.set("9:9", null);
  for (const [type, params] of [
    ["create_sticky", { text: "x", parentId: "9:9" }],
    ["create_shape_with_text", { text: "x", parentId: "9:9" }],
    ["create_section", { parentId: "9:9" }],
    ["create_connector", { startX: 0, startY: 0, endX: 1, endY: 1, parentId: "9:9" }],
  ] as const) {
    const response = await dispatch(type, undefined, params);
    expect(response.error, type).toMatch(/9:9/);
  }
  expect(created).toEqual([]);
});

test("create_shape_with_text keeps the SQUARE default and applies every style", async () => {
  const { fonts } = board();
  const plain = await dispatch("create_shape_with_text", undefined, { text: "DB" });
  expect(plain.error).toBeUndefined();
  expect(plain.data).toMatchObject({ type: "SHAPE_WITH_TEXT", nodeName: "SHAPE_WITH_TEXT" });
  expect(nodes.get(plain.data.nodeId).shapeType).toBe("SQUARE");

  const styled = await dispatch("create_shape_with_text", undefined, {
    text: "Store",
    shapeType: "ENG_DATABASE",
    name: "DB",
    fontFamily: "Inter",
    fontStyle: "Bold",
    fontSize: 20,
    rotation: 45,
    fillHex: "#ff0000",
    strokeHex: "#0000ff",
    strokeWeight: 3,
    textFillHex: "#00ff00",
    width: 120,
    height: 80,
  });
  expect(styled.error).toBeUndefined();
  const shape = nodes.get(styled.data.nodeId);
  expect(shape.shapeType).toBe("ENG_DATABASE");
  expect(shape.text.fontName).toEqual({ family: "Inter", style: "Bold" });
  expect([shape.text.characters, shape.text.fontSize, shape.rotation]).toEqual(["Store", 20, 45]);
  expect(shape.fills[0].color).toEqual({ r: 1, g: 0, b: 0 });
  expect(shape.strokes[0].color).toEqual({ r: 0, g: 0, b: 1 });
  expect(shape.text.fills[0].color).toEqual({ r: 0, g: 1, b: 0 });
  expect([shape.strokeWeight, shape.width, shape.height]).toEqual([3, 120, 80]);
  expect(fonts).toContain("Inter Bold");
});

test("a shape whose font cannot load is removed again", async () => {
  const { created } = board();
  const response = await dispatch("create_shape_with_text", undefined, {
    text: "x",
    fontFamily: "Missing",
    fontStyle: "Regular",
  });
  expect(response.error).toMatch(/font not found/);
  expect(created.map((n) => n.removed)).toEqual([true]);
});

test("create_section takes a parent, a fill and hidden contents", async () => {
  const { section } = board();
  const response = await dispatch("create_section", undefined, {
    name: "Inner",
    parentId: "8:1",
    width: 300,
    height: 200,
    fillHex: "#eeeeee",
    fillOpacity: 0.5,
    sectionContentsHidden: true,
    x: 10,
  });
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({ type: "SECTION", parentId: "8:1", width: 300, x: 10 });
  const inner = section.children[0];
  expect(inner.sectionContentsHidden).toBe(true);
  expect(inner.fills[0]).toMatchObject({ opacity: 0.5 });
});

test("a labelled connector attaches despite a straight toolbar and an empty label font", async () => {
  const { base, fonts } = board();
  const a = base("SHAPE_WITH_TEXT");
  const b = base("SHAPE_WITH_TEXT");
  const response = await dispatch("create_connector", undefined, {
    startNodeId: a.id,
    endNodeId: b.id,
    text: "yes",
  });
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({
    type: "CONNECTOR",
    startNodeId: a.id,
    endNodeId: b.id,
    parentId: "8:0",
  });
  const connector = nodes.get(response.data.nodeId);
  expect(connector.connectorLineType).toBe("ELBOWED");
  expect(connector.ends.map((e: any) => e.magnet)).toEqual(["AUTO", "AUTO"]);
  expect(connector.text.characters).toBe("yes");
  expect(fonts).toEqual(["Inter Medium"]);
});

test("a self-loop keeps its two distinct sides; chosen anchors override them", async () => {
  const { base } = board();
  const a = base("SHAPE_WITH_TEXT");
  const loop = await dispatch("create_connector", undefined, {
    startNodeId: a.id,
    endNodeId: a.id,
  });
  expect(nodes.get(loop.data.nodeId).ends.map((e: any) => e.magnet)).toEqual(["RIGHT", "TOP"]);
  const b = base("SHAPE_WITH_TEXT");
  const sides = await dispatch("create_connector", undefined, {
    startNodeId: a.id,
    endNodeId: b.id,
    startAnchor: "top",
    endAnchor: "bottom",
  });
  expect(nodes.get(sides.data.nodeId).ends.map((e: any) => e.magnet)).toEqual(["TOP", "BOTTOM"]);
});

test("a floating start meets a node end; the free point is given to Figma on the canvas", async () => {
  const { section, base } = board();
  const target = base("STICKY");
  section.appendChild(target);
  const response = await dispatch("create_connector", undefined, {
    startX: 3,
    startY: 4,
    endNodeId: target.id,
    endAnchor: "left",
    parentId: "8:1",
    strokeHex: "#123456",
    strokeWeight: 4,
    name: "Flow",
  });
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({ parentId: "8:1", endNodeId: target.id, nodeName: "Flow" });
  expect(response.data.startNodeId).toBeUndefined();
  const connector = nodes.get(response.data.nodeId);
  // An unattached endpoint is a canvas location; the section sits at (100, 100).
  expect(connector.ends).toEqual([
    { position: { x: 103, y: 104 }, parentAtAssignment: "8:1" },
    { endpointNodeId: target.id, magnet: "LEFT", parentAtAssignment: "8:1" },
  ]);
  expect(connector.strokeWeight).toBe(4);
  expect(connector.strokes[0].color.r).toBeCloseTo(0x12 / 255);
});

test("free connector ends follow a nested, rotated parent's transform; a page parent keeps them", async () => {
  const { section, page } = board();
  // A frame inside the section, turned 90° and placed at (300, 50) on the canvas.
  const inner: any = {
    id: "8:2",
    name: "Turned",
    type: "FRAME",
    children: [],
    absoluteTransform: [
      [0, -1, 300],
      [1, 0, 50],
    ],
    appendChild(child: any) {
      child.parent?.children?.splice(child.parent.children.indexOf(child), 1);
      inner.children.push(child);
      child.parent = inner;
    },
  };
  section.appendChild(inner);
  nodes.set(inner.id, inner);
  const turned = await dispatch("create_connector", undefined, {
    startX: 10,
    startY: 0,
    endX: 0,
    endY: 20,
    parentId: "8:2",
  });
  expect(turned.error).toBeUndefined();
  expect(nodes.get(turned.data.nodeId).ends.map((e: any) => e.position)).toEqual([
    { x: 300, y: 60 },
    { x: 280, y: 50 },
  ]);

  const onPage = await dispatch("create_connector", undefined, {
    startX: 3,
    startY: 4,
    endX: 5,
    endY: 6,
    parentId: page.id,
  });
  expect(nodes.get(onPage.data.nodeId).ends.map((e: any) => e.position)).toEqual([
    { x: 3, y: 4 },
    { x: 5, y: 6 },
  ]);
});

test("a node start and a free end in a section: only the free end moves to the canvas", async () => {
  const { section, base } = board();
  const source = base("STICKY");
  section.appendChild(source);
  const response = await dispatch("create_connector", undefined, {
    startNodeId: source.id,
    startAnchor: "bottom",
    endX: -20,
    endY: 30,
    parentId: "8:1",
  });
  expect(response.error).toBeUndefined();
  expect(nodes.get(response.data.nodeId).ends).toEqual([
    { endpointNodeId: source.id, magnet: "BOTTOM", parentAtAssignment: "8:1" },
    { position: { x: 80, y: 130 }, parentAtAssignment: "8:1" },
  ]);
});

test("a missing or off-page endpoint creates nothing", async () => {
  const { created } = board();
  nodes.set("9:8", null);
  const missing = await dispatch("create_connector", undefined, {
    startNodeId: "9:8",
    endX: 1,
    endY: 1,
  });
  expect(missing.error).toMatch(/9:8/);
  const otherPage: any = { id: "9:0", type: "PAGE" };
  nodes.set("9:7", { id: "9:7", name: "Far", type: "STICKY", parent: otherPage });
  const away = await dispatch("create_connector", undefined, {
    startNodeId: "9:7",
    endX: 1,
    endY: 1,
  });
  expect(away.error).toMatch(/page/);
  expect(created).toEqual([]);
});

test("a connector that fails to attach is removed again", async () => {
  const { base, created } = board();
  const a = base("SHAPE_WITH_TEXT");
  stub("loadFontAsync", async () => {
    throw new Error("label font failed");
  });
  const response = await dispatch("create_connector", undefined, {
    startNodeId: a.id,
    endX: 1,
    endY: 2,
    text: "x",
  });
  expect(response.error).toMatch(/label font failed/);
  expect(created.at(-1).type).toBe("CONNECTOR");
  expect(created.at(-1).removed).toBe(true);
});

test("duplicate_nodes keeps a copy of an off-page node beside its original", async () => {
  const parent: any = { id: "10:1", type: "FRAME", children: [] as any[] };
  parent.insertChild = (index: number, node: any) => {
    node.parent = parent;
    parent.children.splice(index, 0, node);
  };
  const strayPage: any = { id: "10:0", type: "PAGE" };
  const original: any = { id: "10:2", name: "Card", type: "FRAME", parent };
  parent.children.push(original);
  original.clone = () => ({ id: "10:3", name: "Card", type: "FRAME", parent: strayPage });
  nodes.set("10:2", original);
  const response = await dispatch("duplicate_nodes", ["10:2"]);
  expect(response.error).toBeUndefined();
  expect(response.data.duplicates[0]).toMatchObject({ nodeId: "10:3", parentId: "10:1" });
  expect(parent.children.map((c: any) => c.id)).toEqual(["10:2", "10:3"]);
});

/** A frame whose clones Figma parents under the current page, as its docs say. */
const duplicable = (id: string, parent: any, landing: any, made: any[]) => {
  const node: any = { id, name: id, type: "FRAME", parent, x: 30, y: 40, children: [] };
  parent.children.push(node);
  node.clone = () => {
    const copy: any = {
      id: `${id}-copy`,
      name: id,
      type: "FRAME",
      parent: landing,
      x: node.x,
      y: node.y,
      removed: false,
      remove() {
        copy.removed = true;
        copy.parent?.children?.splice(copy.parent.children.indexOf(copy), 1);
      },
    };
    landing.children.push(copy);
    made.push(copy);
    return copy;
  };
  nodes.set(id, node);
  return node;
};
const insertable = (id: string, type = "FRAME", parent: any = null): any => {
  const node: any = { id, name: id, type, parent, children: [] as any[] };
  node.insertChild = (index: number, child: any) => {
    child.parent?.children?.splice(child.parent.children.indexOf(child), 1);
    node.children.splice(index, 0, child);
    child.parent = node;
  };
  return node;
};

test("duplicate_nodes refuses a layer inside an instance, nested or direct, before cloning", async () => {
  const landing = insertable("11:0", "PAGE");
  const instance = insertable("11:1", "INSTANCE", landing);
  instance.insertChild = () => {
    throw new Error("Cannot move node. New parent is an instance or is inside of an instance");
  };
  const inner = insertable("I11:1;2", "FRAME", instance);
  const free = insertable("11:3", "FRAME", landing);
  const made: any[] = [];
  duplicable("11:4", free, landing, made);
  duplicable("I11:1;3", instance, landing, made);
  duplicable("I11:1;4", inner, landing, made);
  for (const ids of [
    ["11:4", "I11:1;3"],
    ["11:4", "I11:1;4"],
  ]) {
    const response = await dispatch("duplicate_nodes", ids);
    expect(response.error).toMatch(/inside the instance 11:1/);
    expect(response.error).toMatch(/Duplicate the instance/);
  }
  expect(made).toEqual([]);
});

test("duplicate_nodes removes every copy it made when a later one cannot be placed", async () => {
  const current = insertable("12:0", "PAGE");
  const stray = insertable("12:9", "PAGE");
  const ok = insertable("12:1", "FRAME", stray);
  const locked = insertable("12:2", "FRAME", stray);
  locked.insertChild = () => {
    throw new Error("insertion refused");
  };
  const made: any[] = [];
  duplicable("12:3", ok, current, made);
  duplicable("12:4", locked, current, made);
  const response = await dispatch("duplicate_nodes", ["12:3", "12:4"]);
  expect(response.error).toMatch(/insertion refused/);
  expect(made.map((copy) => copy.removed)).toEqual([true, true]);
  expect([...ok.children, ...current.children].map((c: any) => c.id)).toEqual(["12:3"]);
});

test("duplicate_nodes checks every node before its first clone", async () => {
  const current = insertable("13:0", "PAGE");
  const made: any[] = [];
  duplicable("13:1", current, current, made);
  nodes.set("13:2", { id: "13:2", name: "Plain", type: "FRAME", parent: current });
  const response = await dispatch("duplicate_nodes", ["13:1", "13:2"]);
  expect(response.error).toMatch(/does not support duplication: 13:2/);
  expect(made).toEqual([]);
});

test("an off-page duplicate lands beside its original at the original's position", async () => {
  const current = insertable("14:0", "PAGE");
  const stray = insertable("14:9", "PAGE");
  const parent = insertable("14:1", "FRAME", stray);
  const made: any[] = [];
  const original = duplicable("14:2", parent, current, made);
  const response = await dispatch("duplicate_nodes", ["14:2"]);
  expect(response.error).toBeUndefined();
  expect(response.data.duplicates).toEqual([
    { sourceNodeId: "14:2", nodeId: "14:2-copy", nodeName: "14:2", parentId: "14:1" },
  ]);
  expect([made[0].x, made[0].y]).toEqual([original.x, original.y]);
  expect(current.children).toEqual([]);
});
