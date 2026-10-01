// Live cleanup regression checks against the candidate worktree's Dev plugin.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PORT } from "./port.mjs";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve("dist/index.js")],
  env: { ...process.env, FIGMA_DESIGN_RELAY_PORT: String(PORT) },
  stderr: "pipe",
});
const client = new Client({ name: "cleanup-live", version: "0.7.7" }, { capabilities: {} });
transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));
const cases = [];
const fixtures = [];
const scratch = await mkdtemp(path.join(process.cwd(), ".smoke", "cleanup-fixtures-"));
const outside = await mkdtemp(path.join(tmpdir(), "relay-cleanup-outside-"));

async function raw(name, args = {}) {
  return client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
}
async function call(name, args = {}) {
  const result = await raw(name, args);
  assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
  const text = result.content.find((block) => block.type === "text")?.text;
  return text ? JSON.parse(text) : undefined;
}
async function script(fileKey, code) {
  const result = await call("run_script", { fileKey, code });
  assert.equal(result.ok, true);
  return result.value;
}
async function check(name, action) {
  try {
    const detail = await action();
    cases.push({ name, passed: true, detail });
    console.log(`PASS ${name} ${JSON.stringify(detail ?? "")}`);
  } catch (error) {
    cases.push({ name, passed: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}

try {
  await client.connect(transport);
  const files = await call("list_files");
  assert(files.some((file) => file.editorType === "figma"));
  assert(files.some((file) => file.editorType === "figjam"));
  assert(files.some((file) => file.editorType === "slides"));
  console.log(`Connected editors: ${JSON.stringify(files)}`);
  for (const file of files) {
    await check(`routing/read ${file.editorType} ${file.fileName}`, async () => {
      const meta = await call("get_metadata", { fileKey: file.fileKey });
      const identity = await script(
        file.fileKey,
        "return { name: figma.root.name, editor: figma.editorType, page: figma.currentPage.id };"
      );
      assert.equal(identity.name, file.fileName);
      assert.equal(identity.editor, file.editorType);
      const selection = await call("get_selection", { fileKey: file.fileKey });
      assert(Array.isArray(selection));
      return { identity, metadataReturned: !!meta, selectedNodes: selection.length };
    });
  }
  const design =
    files.find((file) => file.fileName === "Screen" && file.editorType === "figma") ??
    files.find((file) => file.editorType === "figma");
  const key = design.fileKey;
  const fixture = await script(
    key,
    `
    const originalPage = figma.currentPage.id;
    const page = figma.createPage(); page.name = '[relay cleanup live test]';
    const frame = figma.createFrame(); frame.name = 'Cleanup fixture'; frame.resize(64, 64); page.appendChild(frame);
    const vector = figma.createNodeFromSvg('<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16H0z" fill="red"/></svg>');
    vector.name = 'Icon "quoted"'; frame.appendChild(vector);
    return { originalPage, pageId: page.id, frameId: frame.id, iconId: vector.id };
  `
  );
  fixtures.push({ fileKey: key, id: fixture.pageId });
  await check("noncurrent page get_node through follower", async () => {
    const node = await call("get_node", { fileKey: key, nodeId: fixture.pageId });
    assert.equal(node.id, fixture.pageId);
    assert(node.children.some((child) => child.id === fixture.frameId));
    assert.equal(await script(key, "return figma.currentPage.id;"), fixture.originalPage);
    return { pageId: node.id, children: node.children.length, currentPagePreserved: true };
  });
  await check("layout tree through follower", async () => {
    const result = await call("get_layout_tree", { fileKey: key, rootId: fixture.frameId });
    assert(result);
    return { returned: true };
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=",
    "base64"
  );
  const imagePath = path.join(scratch, "pixel.png");
  await writeFile(imagePath, png);
  await check("local create_image and actual Figma image hash", async () => {
    const result = await call("create_image", {
      fileKey: key,
      source: imagePath,
      parentId: fixture.frameId,
      width: 16,
      height: 16,
    });
    const id = result.id ?? result.nodeId;
    assert(id, JSON.stringify(result));
    const paints = await script(
      key,
      `const node = await figma.getNodeByIdAsync(${JSON.stringify(id)}); return node.fills.map(p => ({ type: p.type, hash: p.imageHash }));`
    );
    assert(paints.some((paint) => paint.type === "IMAGE" && paint.hash));
    return { id, imageHashPresent: true };
  });
  const layerPath = path.join(scratch, "layers.json");
  await writeFile(
    layerPath,
    JSON.stringify({
      type: "FRAME",
      name: "HTML fixture",
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      children: [
        {
          type: "RECTANGLE",
          name: "Imported image",
          x: 0,
          y: 0,
          width: 16,
          height: 16,
          fills: [{ type: "IMAGE", scaleMode: "FILL", intArr: [...png] }],
        },
      ],
    })
  );
  await check("HTML image import assigns normalized paint", async () => {
    const imported = await call("import_html_layers", {
      fileKey: key,
      source: layerPath,
      parentId: fixture.frameId,
    });
    const id = imported.id ?? imported.nodeId;
    assert(id, JSON.stringify(imported));
    const images = await script(
      key,
      `const root = await figma.getNodeByIdAsync(${JSON.stringify(id)}); return root.findAll(n => n.type === 'RECTANGLE').map(n => ({id: n.id, paints: n.fills.map(p => ({ type: p.type, hash: p.imageHash }))}));`
    );
    assert(
      images.some((image) => image.paints.some((paint) => paint.type === "IMAGE" && paint.hash))
    );
    return { id, imageRectangles: images.length, layerCount: imported.layerCount };
  });
  await check("screenshot saves inside workspace through follower", async () => {
    const destination = path.join(scratch, "fixture.png");
    const result = await call("save_screenshots", {
      fileKey: key,
      items: [{ nodeId: fixture.frameId, outputPath: destination }],
    });
    assert.equal(result.succeeded, 1);
    assert((await stat(destination)).size > 0);
    return { bytes: (await stat(destination)).size };
  });
  await check("design context exports assets and valid reference tags", async () => {
    const result = await raw("get_design_context", {
      fileKey: key,
      nodeId: fixture.frameId,
      depth: 5,
      format: "html",
      assetDir: path.join(scratch, "assets"),
    });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    assert(text.includes("Exported assets"));
    assert(!text.includes("<div />"));
    assert(result.content.some((block) => block.type === "image"));
    return { textChars: text.length, screenshotReturned: true };
  });
  await symlink(outside, path.join(scratch, "external"), "junction");
  await writeFile(path.join(outside, "private.png"), png);
  await check("live file tools reject external links", async () => {
    const image = await raw("create_image", {
      fileKey: key,
      source: path.join(scratch, "external", "private.png"),
    });
    assert.equal(image.isError, true);
    const screenshots = await raw("save_screenshots", {
      fileKey: key,
      items: [
        {
          nodeId: fixture.frameId,
          outputPath: path.join(scratch, "external", "new", "fixture.png"),
        },
      ],
    });
    const saved = JSON.parse(screenshots.content.find((block) => block.type === "text").text);
    assert.equal(saved.hasErrors, true);
    assert.equal(saved.failed, 1);
    assert.equal(saved.results[0].success, false);
    assert(saved.results[0].error.includes("outside the MCP server working directory"));
    assert.equal(await stat(path.join(outside, "new")).catch(() => null), null);
    return {
      imageReadRefused: true,
      screenshotWriteRefused: true,
      noExternalDirectoriesCreated: true,
    };
  });
  await check("mapped private URL rejected before Figma mutation", async () => {
    const result = await raw("create_image", {
      fileKey: key,
      source: "http://[::ffff:127.0.0.1]/pixel.png",
    });
    assert.equal(result.isError, true);
    assert(result.content[0].text.includes("blocked internal"));
    return { refused: true };
  });
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  for (const fixture of fixtures) {
    await check("remove owned Figma fixture", async () => {
      return script(
        fixture.fileKey,
        `const node = await figma.getNodeByIdAsync(${JSON.stringify(fixture.id)}); if (node) node.remove(); return { removed: ${JSON.stringify(fixture.id)} };`
      );
    }).catch(() => {
      process.exitCode = 1;
    });
  }
  await client.close().catch(() => {});
  await rm(scratch, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
  console.log(`RESULT ${JSON.stringify({ port: PORT, cases })}`);
}
