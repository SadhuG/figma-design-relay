import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeSaveScreenshots, registerTools } from "./tools.js";
import { exportAssets } from "./assets.js";

let root: string;
let workspace: string;
let outside: string;
let previousCwd: string;
const handlers = new Map<string, (...args: any[]) => Promise<any>>();
const sender = {
  async sendWithParams(_type: string, ids?: string[]) {
    return {
      type: "get_screenshot",
      requestId: "r",
      data: {
        exports: [
          {
            nodeId: ids?.[0] ?? "1:1",
            nodeName: "Icon",
            format: "PNG",
            base64: "bmV3",
            width: 10,
            height: 10,
          },
        ],
      },
    };
  },
};
beforeEach(async () => {
  previousCwd = process.cwd();
  root = await mkdtemp(path.join(tmpdir(), "relay-files-"));
  workspace = path.join(root, "workspace");
  outside = path.join(root, "outside");
  await mkdir(workspace);
  await mkdir(outside);
  process.chdir(workspace);
  registerTools(
    {
      tool(name: string, ...args: any[]) {
        handlers.set(name, args.at(-1));
      },
    } as any,
    sender as any,
    0
  );
});
afterEach(async () => {
  process.chdir(previousCwd);
  await rm(root, { recursive: true, force: true });
  handlers.clear();
});

test("screenshots refuse an external directory link before creating subdirectories", async () => {
  await symlink(outside, path.join(workspace, "linked"), "junction");
  const result = await executeSaveScreenshots(sender, [
    { nodeId: "1:1", outputPath: "linked/new/icon.png" },
  ]);
  expect(result.results[0].success).toBe(false);
  expect(result.results[0].error).toContain("inside");
  expect(await stat(path.join(outside, "new")).catch(() => null)).toBeNull();
});

test("local image reads refuse an external directory link", async () => {
  await writeFile(path.join(outside, "image.png"), "private");
  await symlink(outside, path.join(workspace, "linked"), "junction");
  const result = await handlers.get("create_image")!({ source: "linked/image.png" });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("inside");
});

test("screenshots refuse a dangling external directory link", async () => {
  await symlink(path.join(outside, "missing"), path.join(workspace, "linked"), "junction");
  const result = await executeSaveScreenshots(sender, [
    { nodeId: "1:1", outputPath: "linked/new/icon.png" },
  ]);
  expect(result.results[0].success).toBe(false);
  expect(await stat(path.join(outside, "missing")).catch(() => null)).toBeNull();
});

test("workspace paths beginning with two dots remain valid", async () => {
  const result = await executeSaveScreenshots(sender, [
    { nodeId: "1:1", outputPath: "..icons/icon.png" },
  ]);
  expect(result.results[0].success).toBe(true);
  expect(await readFile(path.join(workspace, "..icons/icon.png"), "utf8")).toBe("new");
});

test("asset exports validate the final path as well as its directory", async () => {
  await mkdir(path.join(workspace, "assets"));
  await writeFile(path.join(outside, "icon.svg"), "original");
  // A junction checks the same final-path boundary without Windows symlink privileges.
  await symlink(outside, path.join(workspace, "assets", "icon-1-1.svg"), "junction");
  await expect(exportAssets(sender, ["1:1"], "assets")).rejects.toThrow("outside");
  expect(await readFile(path.join(outside, "icon.svg"), "utf8")).toBe("original");
});

test.skipIf(process.platform === "win32")(
  "asset exports cannot overwrite an external file through a leaf symlink",
  async () => {
    await mkdir(path.join(workspace, "assets"));
    await writeFile(path.join(outside, "icon.svg"), "original");
    await symlink(path.join(outside, "icon.svg"), path.join(workspace, "assets", "icon-1-1.svg"));
    await expect(exportAssets(sender, ["1:1"], "assets")).rejects.toThrow("outside");
    expect(await readFile(path.join(outside, "icon.svg"), "utf8")).toBe("original");
  }
);

test.skipIf(process.platform === "win32")(
  "asset exports cannot create an external file through a dangling leaf symlink",
  async () => {
    await mkdir(path.join(workspace, "assets"));
    const destination = path.join(outside, "new.svg");
    await symlink(destination, path.join(workspace, "assets", "icon-1-1.svg"));
    await expect(exportAssets(sender, ["1:1"], "assets")).rejects.toThrow(
      "unresolved symbolic link"
    );
    expect(await stat(destination).catch(() => null)).toBeNull();
  }
);

test.each(["[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]", "[::ffff:192.168.1.1]", "[fe80::1]"])(
  "image URLs refuse mapped internal IPv4 %s",
  async (host) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("image")) as typeof fetch;
    try {
      const result = await handlers.get("create_image")!({ source: `http://${host}/image.png` });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("blocked internal");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test("image download deadline includes a stalled response body", async () => {
  const originalFetch = globalThis.fetch;
  let stream: ReadableStreamDefaultController<Uint8Array>;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
    });
    init?.signal?.addEventListener("abort", () =>
      stream.error(new DOMException("Aborted", "AbortError"))
    );
    return new Response(body);
  }) as typeof fetch;
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      handlers.get("create_image")!({ source: "https://8.8.8.8/image.png" }),
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(() => reject(new Error("Image body outlived its deadline")), 16_000);
      }),
    ]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Timed out fetching image");
  } finally {
    clearTimeout(guard);
    stream!.error(new Error("test cleanup"));
    globalThis.fetch = originalFetch;
  }
}, 20_000);
