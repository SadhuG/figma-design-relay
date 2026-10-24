import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { checkStaged, stageRelease } from "./package-release.mjs";

let root;
let outDir;

const write = (path, text = "") => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

const manifest = (id = "figma-design-relay") =>
  JSON.stringify({ id, networkAccess: { allowedDomains: ["ws://localhost:1994"] } });

// Writes the runtime dependencies the way `bun install --production` would.
const installRuntime = (serverDir, extra = []) => {
  for (const name of ["@modelcontextprotocol/sdk", "ws", "zod", ...extra]) {
    const dir = join(serverDir, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  }
};

const stage = (install = installRuntime) =>
  stageRelease({ root, outDir, version: "0.11.1", install });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "relay-pkg-"));
  outDir = join(root, ".release-test");
  write("plugin/manifest.json", manifest());
  write("plugin/dist/code.js", "figma.showUI(__html__);");
  write("plugin/dist/index.html", '<script>new WebSocket("ws://localhost:1994/ws")</script>');
  write("server/dist/index.js", "#!/usr/bin/env node\nimport './leader.js';\n");
  write(
    "server/package.json",
    JSON.stringify({
      name: "figma-design-relay-server",
      dependencies: { "@modelcontextprotocol/sdk": "^1.26.0", ws: "^8.18.0", zod: "^3.24.0" },
      devDependencies: { typescript: "^5.7.0" },
    })
  );
  write("server/bun.lock", "{}");
  write("server/dashboard/index.html", "<!doctype html>");
  write("server/dashboard/render.js", "export {};");
  write("server/dashboard/dashboard.css", "body{}");
  write("server/dashboard/render.test.ts", "// not shipped");
  write("README.md", "# Figma Design Relay");
  write("CHANGELOG.md", "# Changelog");
  write("LICENSE.md", "MIT");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("stageRelease", () => {
  test("stages the documented layout", () => {
    const staged = stage();
    expect(basename(staged)).toBe("figma-design-relay");
    expect(checkStaged(staged)).toEqual([]);
    expect(readFileSync(join(staged, "VERSION"), "utf8")).toBe("0.11.1\n");
    for (const path of [
      "plugin/manifest.json",
      "plugin/dist/code.js",
      "server/dist/index.js",
      "server/dashboard/index.html",
      "server/node_modules/ws/package.json",
      "README.md",
      "CHANGELOG.md",
      "LICENSE.md",
    ]) {
      expect(existsSync(join(staged, path))).toBe(true);
    }
    expect(existsSync(join(staged, "server/dashboard/render.test.ts"))).toBe(false);
  });

  test("empties a stale out directory", () => {
    mkdirSync(join(outDir, "figma-design-relay"), { recursive: true });
    writeFileSync(join(outDir, "figma-design-relay", "old.txt"), "stale");
    const staged = stage();
    expect(existsSync(join(staged, "old.txt"))).toBe(false);
  });
});

describe("checkStaged", () => {
  test("refuses a dev-slot build", () => {
    write("plugin/dist/manifest.json", manifest("figma-design-relay-dev-x"));
    expect(checkStaged(stage()).join("\n")).toMatch(/dev manifest/);
  });

  test("refuses a plugin that dials another port", () => {
    write("plugin/dist/index.html", '<script>new WebSocket("ws://localhost:1996/ws")</script>');
    expect(checkStaged(stage()).join("\n")).toMatch(/1994/);
  });

  test("refuses a manifest with the wrong id", () => {
    write("plugin/manifest.json", manifest("figma-design-relay-dev-x"));
    expect(checkStaged(stage()).join("\n")).toMatch(/id/);
  });

  test("refuses a server without the node shebang", () => {
    write("server/dist/index.js", "import './leader.js';\n");
    expect(checkStaged(stage()).join("\n")).toMatch(/shebang/);
  });

  test("refuses dev dependencies", () => {
    const problems = checkStaged(stage((dir) => installRuntime(dir, ["typescript"])));
    expect(problems.join("\n")).toMatch(/typescript/);
  });

  test("refuses missing runtime dependencies", () => {
    expect(checkStaged(stage(() => {})).join("\n")).toMatch(/\bws\b/);
  });

  test("refuses missing dashboard files", () => {
    rmSync(join(root, "server/dashboard/index.html"));
    expect(checkStaged(stage()).join("\n")).toMatch(/dashboard/);
  });
});
