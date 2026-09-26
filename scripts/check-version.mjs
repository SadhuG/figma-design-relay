// Checks that the server and the plugin carry the same version and that
// CHANGELOG.md has an entry for it. CI runs this on every push; release.yml
// runs it too and takes the version it prints.
//
//   bun scripts/check-version.mjs            print the version, or fail
//   bun scripts/check-version.mjs --notes    print that version's changelog entry
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const server = JSON.parse(read("server/package.json")).version;
const plugin = JSON.parse(read("plugin/package.json")).version;
if (server !== plugin) {
  fail(
    `server/package.json is ${server} but plugin/package.json is ${plugin}. ` +
      "Bump both to the same version."
  );
}

// Entries are headed `## [x.y.z] - YYYY-MM-DD`; the body runs to the next `## `.
const lines = read("CHANGELOG.md").split("\n");
const start = lines.findIndex((line) => line.startsWith(`## [${server}] - `));
if (start === -1) {
  fail(
    `CHANGELOG.md has no "## [${server}] - YYYY-MM-DD" entry. ` +
      "Move the Unreleased notes under a heading for this version."
  );
}

if (process.argv.includes("--notes")) {
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  console.log(
    rest
      .slice(0, end === -1 ? undefined : end)
      .join("\n")
      .trim()
  );
} else {
  console.log(server);
}
