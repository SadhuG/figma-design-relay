// Stages the release archive's folder from the server and plugin builds, then
// checks it is something a user can run with Node alone. release.yml runs this
// and zips the result; nothing else decides what ships.
//
//   bun scripts/package-release.mjs <outDir>    stage <outDir>/figma-design-relay
//
// Build both halves first, from a checkout with no .dev-slot.json: a dev-slot
// plugin dials its own port and would never reach a user's relay.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const FOLDER = "figma-design-relay";
const STABLE_ID = "figma-design-relay";
const STABLE_WS = "ws://localhost:1994";

const installProduction = (serverDir) =>
  execFileSync("bun", ["install", "--production", "--frozen-lockfile"], {
    cwd: serverDir,
    stdio: "inherit",
  });

/** Copy everything the archive carries into `<outDir>/figma-design-relay`, emptying it first. */
export function stageRelease({ root, outDir, version, install = installProduction }) {
  const staged = join(outDir, FOLDER);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(staged, { recursive: true });
  const copy = (path) => {
    if (existsSync(join(root, path)))
      cpSync(join(root, path), join(staged, path), { recursive: true });
  };

  // manifest.json sits beside dist/ so its relative `dist/code.js` and
  // `dist/index.html` resolve on import.
  copy("plugin/manifest.json");
  copy("plugin/dist");

  // dist/ alone is not runnable: the dependencies are not bundled, so the
  // production install below puts them in server/node_modules.
  copy("server/dist");
  copy("server/package.json");
  copy("server/bun.lock");
  // The leader serves its status page from dist/../dashboard. Tests stay behind.
  const dashboard = join(root, "server/dashboard");
  if (existsSync(dashboard)) {
    for (const name of readdirSync(dashboard)) {
      if (/\.(html|css|js)$/.test(name)) copy(`server/dashboard/${name}`);
    }
  }

  for (const path of ["README.md", "CHANGELOG.md", "LICENSE.md"]) copy(path);
  writeFileSync(join(staged, "VERSION"), `${version}\n`);

  if (existsSync(join(staged, "server/package.json"))) install(join(staged, "server"));
  return staged;
}

/** One problem per failed check; `[]` means the folder can be released. */
export function checkStaged(dir) {
  const problems = [];
  const has = (path) => existsSync(join(dir, path));
  const read = (path) => (has(path) ? readFileSync(join(dir, path), "utf8") : "");
  const need = (path, fix) => {
    if (!has(path)) problems.push(`${path} is missing — ${fix}`);
  };

  for (const path of ["VERSION", "README.md", "CHANGELOG.md", "LICENSE.md"]) {
    need(path, "stage from the repository root");
  }

  // Plugin: the stable manifest, a build that dials the stable relay.
  need("plugin/manifest.json", "stage from the repository root");
  need("plugin/dist/code.js", "run `bun run build` in plugin/");
  need("plugin/dist/index.html", "run `bun run build` in plugin/");
  if (has("plugin/dist/manifest.json")) {
    problems.push(
      "plugin/dist/manifest.json is a dev manifest — this is a dev-slot build; " +
        "build the plugin from a checkout without .dev-slot.json"
    );
  }
  if (has("plugin/manifest.json")) {
    const { id } = JSON.parse(read("plugin/manifest.json"));
    if (id !== STABLE_ID) {
      problems.push(
        `plugin/manifest.json has id "${id}", not "${STABLE_ID}" — ship the stable manifest`
      );
    }
  }
  if (has("plugin/dist/index.html")) {
    const addresses = new Set(read("plugin/dist/index.html").match(/ws:\/\/localhost:\d+/g) ?? []);
    if (!addresses.has(STABLE_WS) || addresses.size !== 1) {
      problems.push(
        `plugin/dist/index.html dials ${[...addresses].join(", ") || "no relay"}, not ${STABLE_WS} only — ` +
          "rebuild the plugin without .dev-slot.json or VITE_FIGMA_DESIGN_RELAY_WS"
      );
    }
  }

  // Server: runnable with `node`, dashboard beside dist/, runtime deps only.
  need("server/dist/index.js", "run `bun run build` in server/");
  need("server/package.json", "stage from the repository root");
  if (
    has("server/dist/index.js") &&
    !read("server/dist/index.js").startsWith("#!/usr/bin/env node")
  ) {
    problems.push("server/dist/index.js is missing the node shebang — check server/src/index.ts");
  }
  for (const name of ["index.html", "render.js", "dashboard.css"]) {
    need(`server/dashboard/${name}`, "the leader serves the dashboard from server/dashboard/");
  }
  if (has("server/package.json")) {
    const pkg = JSON.parse(read("server/package.json"));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      need(
        `server/node_modules/${name}/package.json`,
        `runtime dependency ${name} was not installed`
      );
    }
    for (const name of Object.keys(pkg.devDependencies ?? {})) {
      if (has(`server/node_modules/${name}`)) {
        problems.push(
          `server/node_modules/${name} is a dev dependency — install with --production`
        );
      }
    }
  }
  return problems;
}

/** Every staged path, with node_modules folded into one line. */
function listStaged(dir) {
  const lines = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      const rel = relative(dirname(dir), full).replaceAll("\\", "/");
      if (entry.isDirectory() && entry.name === "node_modules") {
        const count = readdirSync(full).reduce(
          (n, name) =>
            n +
            (name.startsWith("@")
              ? readdirSync(join(full, name)).length
              : name.startsWith(".")
                ? 0
                : 1),
          0
        );
        lines.push(`${rel}/ (${count} packages)`);
      } else if (entry.isDirectory()) {
        walk(full);
      } else {
        lines.push(rel);
      }
    }
  };
  walk(dir);
  return lines;
}

if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("ERROR: usage: bun scripts/package-release.mjs <outDir>");
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  // check-version.mjs fails on its own if the versions or changelog disagree.
  const version = execFileSync(process.execPath, [join(root, "scripts/check-version.mjs")], {
    encoding: "utf8",
  }).trim();
  const staged = stageRelease({ root, outDir, version });
  const problems = checkStaged(staged);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`ERROR: ${problem}`);
    process.exit(1);
  }
  console.log(`Staged v${version} in ${staged}:`);
  for (const line of listStaged(staged)) console.log(`  ${line}`);
}
