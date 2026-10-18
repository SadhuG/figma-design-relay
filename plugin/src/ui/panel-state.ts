// The panel's text and timing rules, kept free of React and the DOM so they can
// be unit-tested. App.tsx only wires them up. The design source is the Figma
// frame "Board 10: Plugin UI, final states".

/** "Nothing selected", "1 node", "3 nodes". */
export function formatSelection(count: number): string {
  if (count === 0) return "Nothing selected";
  return count === 1 ? "1 node" : `${count} nodes`;
}

/** The address the plugin dials, connection type included: `ws://localhost:1994`. */
export function relayAddress(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return wsUrl;
  }
}

/** The port the plugin dials, or "" when the URL can't be read. */
export function relayPort(wsUrl: string): string {
  try {
    return new URL(wsUrl).port;
  } catch {
    return "";
  }
}

export function relayRowText(address: string, connected: boolean): string {
  return connected ? address : `${address} (no answer)`;
}

/** How long to wait before each reconnect attempt; the last value repeats. */
export const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000] as const;

/** Attempt 0 is the first retry after a drop. */
export function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

export type ChipTone = "live" | "working" | "lost";

export type ChipInput = {
  connected: boolean;
  port: string;
  /** From workingLabel; null when no agent is working. */
  workingLabel: string | null;
  /** Seconds until the next attempt; null or 0 while an attempt is under way. */
  retryInSeconds: number | null;
};

/** `text` is for the open panel, `short` for the collapsed bar. Lost beats working beats live. */
export function chipState(input: ChipInput): { tone: ChipTone; text: string; short: string } {
  if (!input.connected) {
    // Short enough to sit beside Retry now in the system font; Inter isn't available in the iframe.
    const text = input.retryInSeconds
      ? `Relay lost · retry in ${input.retryInSeconds} s`
      : "Relay lost · retrying…";
    return { tone: "lost", text, short: "Retrying…" };
  }
  if (input.workingLabel) {
    return { tone: "working", text: input.workingLabel, short: input.workingLabel };
  }
  return { tone: "live", text: `Live on port ${input.port}`, short: `Live · ${input.port}` };
}

/** An agent counts as working while a request runs and for this long after it ends. */
export const WORKING_WINDOW_MS = 10_000;

type Activity = { agent: string | null; finishedAt: number | null };

/** Which agents are working: requests in flight, or finished within WORKING_WINDOW_MS. */
export class ActivityLog {
  private entries = new Map<string, Activity>();

  start(requestId: string, agent: string | null, _now: number): void {
    this.entries.set(requestId, { agent, finishedAt: null });
  }

  finish(requestId: string, now: number): void {
    const entry = this.entries.get(requestId);
    if (entry) entry.finishedAt = now;
  }

  /** The socket closed: responses for in-flight requests will never arrive. */
  clear(): void {
    this.entries.clear();
  }

  /** Distinct agents, in first-seen order. `null` is an agent whose name is unknown. */
  activeAgents(now: number): (string | null)[] {
    this.prune(now);
    return [...new Set([...this.entries.values()].map((entry) => entry.agent))];
  }

  /** Milliseconds until the oldest finished request leaves the window, or null if none will. */
  nextExpiry(now: number): number | null {
    this.prune(now);
    let next: number | null = null;
    for (const { finishedAt } of this.entries.values()) {
      if (finishedAt === null) continue;
      const left = finishedAt + WORKING_WINDOW_MS - now;
      if (next === null || left < next) next = left;
    }
    return next;
  }

  private prune(now: number): void {
    for (const [id, { finishedAt }] of this.entries) {
      if (finishedAt !== null && now - finishedAt >= WORKING_WINDOW_MS) this.entries.delete(id);
    }
  }
}

/** The chip text for the working agents, or null when none is working. */
export function workingLabel(agents: (string | null)[]): string | null {
  if (agents.length === 0) return null;
  if (agents.length > 1) return `${agents.length} agents working`;
  return agents[0] === null ? "Agent working" : `${agents[0]} is working`;
}

/**
 * Readable names for the names MCP clients send in `initialize` (`clientInfo.name`). Any other
 * name is shown as sent. Check a new entry against the "MCP client:" line the relay logs.
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  "cursor-vscode": "Cursor",
  "Visual Studio Code": "VS Code",
  "codex-mcp-client": "Codex",
};

export function agentDisplayName(raw: string | null): string | null {
  if (raw === null) return null;
  // hasOwn, so a client named "constructor" doesn't pick up Object.prototype's.
  return Object.prototype.hasOwnProperty.call(AGENT_DISPLAY_NAMES, raw)
    ? AGENT_DISPLAY_NAMES[raw]
    : raw;
}

/** The working chip's tooltip when two or more agents are working, else null. */
export function agentTooltip(agents: (string | null)[]): string | null {
  if (agents.length < 2) return null;
  return agents.map((agent) => agentDisplayName(agent) ?? "Unnamed agent").join(", ");
}
