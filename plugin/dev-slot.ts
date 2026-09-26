// A dev slot lets a feature worktree run as its own plugin beside the stable
// one: its own name in Figma's Development menu, its own plugin id, its own
// relay port. The main checkout has no slot file and builds the stable plugin
// on 1994; a worktree claims a slot with `bun scripts/dev-slot.mjs`, which
// writes .dev-slot.json at its root. Both Vite configs and the server read it.
//
// Pure except readDevSlot, so the build and the claim script share one set of
// rules and Bun can test them.

import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

export type DevSlot = { name: string; port: number };

export const SLOT_FILE = ".dev-slot.json";
export const FIRST_SLOT_PORT = 1995;
export const LAST_SLOT_PORT = 2019;

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function parseDevSlot(text: string, source: string): DevSlot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON. Delete it and run bun scripts/dev-slot.mjs.`);
  }
  const { name, port } = (raw ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !NAME.test(name)) {
    throw new Error(
      `${source}: name must be lowercase letters, digits and dashes (at most 40), got ${JSON.stringify(name)}.`
    );
  }
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < FIRST_SLOT_PORT ||
    port > LAST_SLOT_PORT
  ) {
    throw new Error(
      `${source}: port must be an integer between ${FIRST_SLOT_PORT} and ${LAST_SLOT_PORT}, got ${JSON.stringify(port)}.`
    );
  }
  return { name, port };
}

/** The slot of the checkout at `root`, or null for the stable checkout. */
export function readDevSlot(root: string): DevSlot | null {
  const file = join(root, SLOT_FILE);
  if (!existsSync(file)) return null;
  return parseDevSlot(readFileSync(file, "utf8"), file);
}

export function slotNameFromBranch(branch: string): string {
  return branch
    .replace(/^(feat|fix|docs|chore|test)\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function pickSlotPort(taken: number[]): number {
  for (let port = FIRST_SLOT_PORT; port <= LAST_SLOT_PORT; port++) {
    if (!taken.includes(port)) return port;
  }
  throw new Error(
    `Every dev slot port (${FIRST_SLOT_PORT}–${LAST_SLOT_PORT}) is taken. Remove finished worktrees with git worktree remove.`
  );
}

type Manifest = {
  name: string;
  id: string;
  main: string;
  ui: string;
  networkAccess: { allowedDomains: string[]; reasoning: string };
  [key: string]: unknown;
};

/** The stable manifest rewritten for a slot, to be written into dist/. */
export function devManifest<M extends Manifest>(base: M, slot: DevSlot): M {
  return {
    ...base,
    name: `${base.name} (Dev: ${slot.name})`,
    id: `${base.id}-dev-${slot.name}`,
    main: posix.relative("dist", base.main),
    ui: posix.relative("dist", base.ui),
    networkAccess: {
      ...base.networkAccess,
      allowedDomains: [`ws://localhost:${slot.port}`],
    },
  };
}

/** Vite plugin: in a slotted checkout, emit the dev manifest into the build output. */
export function devManifestPlugin(base: Manifest, slot: DevSlot | null) {
  return {
    name: "figma-design-relay-dev-manifest",
    generateBundle(this: { emitFile(file: object): string }) {
      if (!slot) return;
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(devManifest(base, slot), null, 2) + "\n",
      });
    },
  };
}
