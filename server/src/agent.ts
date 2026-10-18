/**
 * The calling agent's name, as its MCP client sent it in `initialize` (`clientInfo.name`). It is
 * display-only: the plugin panel shows "Claude Code is working". Nothing routes, authorises or
 * logs by it, but it crosses the follower → leader hop, so it is treated as untrusted text.
 */

export const AGENT_NAME_MAX = 64;

/**
 * Characters that are invisible or rearrange what is shown: C0 and C1 controls with DEL,
 * zero-width characters and direction marks, and bidi embeddings, overrides and isolates.
 * Written as code points so no escape or invisible character has to survive in source.
 */
const HIDDEN_RANGES: [number, number][] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const hex = (code: number) => code.toString(16).padStart(4, "0");
const HIDDEN = new RegExp(
  `[${HIDDEN_RANGES.map(([from, to]) => `\\u${hex(from)}-\\u${hex(to)}`).join("")}]`,
  "g"
);

/** A trimmed, visible name of at most AGENT_NAME_MAX characters (code points), or undefined. */
export function cleanAgentName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = Array.from(raw.replace(HIDDEN, "").trim()).slice(0, AGENT_NAME_MAX).join("");
  return name.length > 0 ? name : undefined;
}
