import { existsSync, readFileSync } from "node:fs";

export const STABLE_PORT = 1994;

// Mirrors plugin/dev-slot.ts, which owns the slot rules; the server only
// needs the port, and cannot import across packages.
const FIRST_SLOT_PORT = 1995;
const LAST_SLOT_PORT = 2019;

/**
 * The port of a feature worktree's dev slot (`.dev-slot.json` at the checkout
 * root), or null in the stable checkout. A slot file that exists but is broken
 * throws: falling back to 1994 would join the dev server to the stable relay.
 */
export function readSlotPort(file: string): number | null {
  if (!existsSync(file)) return null;
  let port: unknown;
  try {
    port = (JSON.parse(readFileSync(file, "utf8")) ?? {}).port;
  } catch {
    throw new Error(`${file} is not valid JSON. Delete it and run bun scripts/dev-slot.mjs.`);
  }
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < FIRST_SLOT_PORT ||
    port > LAST_SLOT_PORT
  ) {
    throw new Error(
      `${file}: port must be an integer between ${FIRST_SLOT_PORT} and ${LAST_SLOT_PORT}, got ${JSON.stringify(port)}.`
    );
  }
  return port;
}

/**
 * FIGMA_DESIGN_RELAY_PORT, else the worktree's slot port, else 1994. An
 * explicitly set but invalid variable throws rather than silently joining the
 * stable relay.
 */
export function resolvePort(raw: string | undefined, slotPort: number | null): number {
  if (raw === undefined) return slotPort ?? STABLE_PORT;
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid FIGMA_DESIGN_RELAY_PORT "${raw}" — expected an integer between 1 and 65535`
    );
  }
  return port;
}
