/**
 * The calling agent's name, as its MCP client sent it in `initialize` (`clientInfo.name`). It is
 * display-only: the plugin panel shows "Claude Code is working". Nothing routes, authorises or
 * logs by it, but it crosses the follower → leader hop, so it is treated as untrusted text.
 */

export const AGENT_NAME_MAX = 64;

// C0 controls and DEL. Built with String.raw so the escapes reach the RegExp intact.
const CONTROL_CHARS = new RegExp(String.raw`[\u0000-\u001f\u007f]`, "g");

/** A trimmed, printable name of at most AGENT_NAME_MAX characters, or undefined. */
export function cleanAgentName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.replace(CONTROL_CHARS, "").trim().slice(0, AGENT_NAME_MAX);
  return name.length > 0 ? name : undefined;
}
