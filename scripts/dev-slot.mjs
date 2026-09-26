// Claims a dev slot for the feature worktree this runs in: a plugin name, a
// plugin id and a relay port of its own, written to .dev-slot.json at the
// worktree root. Run again to print the slot and its setup steps.
//
//   bun scripts/dev-slot.mjs [name]     name defaults to the branch, minus feat/ etc.
//
// The rules live in plugin/dev-slot.ts, shared with the build.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SLOT_FILE,
  parseDevSlot,
  pickSlotPort,
  readDevSlot,
  slotNameFromBranch,
} from "../plugin/dev-slot.ts";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const root = git("rev-parse", "--show-toplevel");
const gitDir = git("rev-parse", "--absolute-git-dir");
const commonDir = git("rev-parse", "--path-format=absolute", "--git-common-dir");
if (resolve(gitDir) === resolve(commonDir)) {
  console.error(
    "This is the main checkout, which always builds the stable plugin on 1994.\n" +
      "Create a worktree for the feature first:\n" +
      "  git worktree add --no-track -b feat/<feature> ../figma-design-relay-<feature> origin/main"
  );
  process.exit(1);
}

let slot = readDevSlot(root);
if (slot) {
  console.log(`This worktree already holds a slot: ${slot.name} on port ${slot.port}.\n`);
} else {
  const others = git("worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => resolve(path) !== resolve(root))
    .flatMap((path) => {
      try {
        const other = readDevSlot(path);
        return other ? [{ ...other, path }] : [];
      } catch {
        return []; // an unreadable slot elsewhere is that worktree's problem
      }
    });

  const name = process.argv[2] ?? slotNameFromBranch(git("branch", "--show-current"));
  const clash = others.find((other) => other.name === name);
  if (clash) {
    console.error(
      `The slot name "${name}" is taken by ${clash.path}. Pass another: bun scripts/dev-slot.mjs <name>`
    );
    process.exit(1);
  }
  // parseDevSlot applies the same rules the build will, so a bad name fails here.
  let port;
  try {
    port = pickSlotPort(others.map((other) => other.port));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  try {
    slot = parseDevSlot(JSON.stringify({ name, port }), "the requested slot");
  } catch (err) {
    console.error(
      `${err.message}\nPass a name of lowercase letters, digits and dashes: bun scripts/dev-slot.mjs <name>`
    );
    process.exit(1);
  }
  writeFileSync(join(root, SLOT_FILE), JSON.stringify(slot, null, 2) + "\n");
  console.log(`Claimed slot ${slot.name} on port ${slot.port} (${SLOT_FILE}).\n`);
}

const server = join(root, "server", "dist", "index.js").replaceAll("\\", "/");
const manifest = join(root, "plugin", "dist", "manifest.json");
console.log(`Next:
  1. Build:   (cd server && bun install && bun run build) && (cd plugin && bun install && bun run build)
  2. Figma:   Plugins → Development → Import plugin from manifest… → ${manifest}
              It appears as "Figma Design Relay (Dev: ${slot.name})".
  3. MCP:     add this entry beside the stable one, then restart the client:
              "figma-design-relay-dev-${slot.name}": { "command": "node", "args": ["${server}"] }
              The server reads the slot and listens on ${slot.port} by itself.
When the branch is merged: remove that Figma import and MCP entry, then git worktree remove.`);
