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

export type ChipTone =
  "connecting" | "live" | "working" | "lost" | "syncing" | "diagram" | "sent" | "leader";

export type ChipInput = {
  /** From ReadProgressLog.percent; null when no long read is showing progress. */
  syncingPercent?: number | null;
  /** The notice to show, from NoticeBoard; diagram wins when both are current. */
  notice?: NoticeKind | null;
  /** Followers the leader heard from in the last minute. */
  followers?: number;
  connected: boolean;
  /** Not connected yet, but no attempt has failed either: the first dial after launch. */
  connecting?: boolean;
  /** "" when the relay URL can't be read. */
  port: string;
  /** From workingLabel; null when no agent is working. */
  workingLabel: string | null;
  /** Seconds until the next attempt; null or 0 while an attempt is under way. */
  retryInSeconds: number | null;
};

/**
 * `text` is for the open panel, `short` for the collapsed bar. Connecting beats lost, so a launch
 * doesn't flash "Relay lost"; then lost > syncing > diagram > working > sent > leader > live.
 */
export function chipState(input: ChipInput): { tone: ChipTone; text: string; short: string } {
  if (!input.connected && input.connecting) {
    return { tone: "connecting", text: "Connecting…", short: "Connecting…" };
  }
  if (!input.connected) {
    // Short enough to sit beside Retry now in the system font; Inter isn't available in the iframe.
    const text = input.retryInSeconds
      ? `Relay lost · retry in ${input.retryInSeconds} s`
      : "Relay lost · retrying…";
    return { tone: "lost", text, short: "Retrying…" };
  }
  if (input.syncingPercent != null) {
    const percent = `${input.syncingPercent}%`;
    return {
      tone: "syncing",
      text: `Reading the layer tree… ${percent}`,
      short: `Syncing ${percent}`,
    };
  }
  if (input.notice === "diagram") {
    return { tone: "diagram", text: "Diagram drawn on this page", short: "Diagram drawn" };
  }
  if (input.workingLabel) {
    return { tone: "working", text: input.workingLabel, short: input.workingLabel };
  }
  if (input.notice === "sent") {
    return { tone: "sent", text: "Sent to your agent", short: "Sent" };
  }
  const followers = input.followers ?? 0;
  if (followers > 0) {
    return {
      tone: "leader",
      text: `Leader · ${followers} ${followers === 1 ? "follower" : "followers"}`,
      short: `Leader +${followers}`,
    };
  }
  if (!input.port) return { tone: "live", text: "Live", short: "Live" };
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

/** How long one connection attempt may take before it counts as failed. */
export const CONNECT_TIMEOUT_MS = 5000;

/** Selection sent: shown once the working state ends, for this long. */
export const SENT_WINDOW_MS = 10_000;
/** Diagram drawn: shown for this long unless another request starts first. */
export const DIAGRAM_WINDOW_MS = 60_000;

export type NoticeKind = "sent" | "diagram";
export type Notice = { kind: NoticeKind; requestId: string; nodeIds: string[] };
type Held = { notice: Notice; expiresAt: number | null };

/**
 * What the agent just read or drew, from the main thread's `selection-sent` and `diagram-drawn`
 * messages. One notice per kind; a new one replaces the old.
 */
export class NoticeBoard {
  private held: Record<NoticeKind, Held | null> = { sent: null, diagram: null };
  /** Recent finishes, so an event that arrives after its own response still gets its clock. */
  private finished = new Map<string, number>();

  record(kind: NoticeKind, requestId: string, nodeIds: string[], now: number): void {
    const notice = { kind, requestId, nodeIds };
    if (kind === "diagram") {
      this.held.diagram = { notice, expiresAt: now + DIAGRAM_WINDOW_MS };
      return;
    }
    const finishedAt = this.finished.get(requestId);
    this.held.sent = {
      notice,
      expiresAt: finishedAt === undefined ? null : finishedAt + WORKING_WINDOW_MS + SENT_WINDOW_MS,
    };
  }

  /** Any other request starting means the agent has moved on from the diagram. */
  requestStarted(requestId: string, _now: number): void {
    if (this.held.diagram && this.held.diagram.notice.requestId !== requestId) {
      this.held.diagram = null;
    }
  }

  /** Sent lasts until the working state that follows the latest finish has ended, plus its window. */
  requestFinished(requestId: string, now: number): void {
    this.finished.set(requestId, now);
    for (const [id, at] of this.finished) {
      if (now - at > DIAGRAM_WINDOW_MS) this.finished.delete(id);
    }
    const sent = this.held.sent;
    if (sent) {
      const until = now + WORKING_WINDOW_MS + SENT_WINDOW_MS;
      sent.expiresAt = sent.expiresAt === null ? until : Math.max(sent.expiresAt, until);
    }
  }

  dismiss(kind: NoticeKind): void {
    this.held[kind] = null;
  }

  /** The socket closed. */
  clear(): void {
    this.held = { sent: null, diagram: null };
    this.finished.clear();
  }

  current(now: number): { diagram: Notice | null; sent: Notice | null } {
    this.prune(now);
    return {
      diagram: this.held.diagram?.notice ?? null,
      sent: this.held.sent?.notice ?? null,
    };
  }

  /** Milliseconds until the nearest notice expires, or null if no clock is running. */
  nextExpiry(now: number): number | null {
    this.prune(now);
    let next: number | null = null;
    for (const held of Object.values(this.held)) {
      if (!held || held.expiresAt === null) continue;
      const left = held.expiresAt - now;
      if (next === null || left < next) next = left;
    }
    return next;
  }

  private prune(now: number): void {
    for (const kind of ["sent", "diagram"] as const) {
      const held = this.held[kind];
      if (held && held.expiresAt !== null && now >= held.expiresAt) this.held[kind] = null;
    }
  }
}

/** A read shows its progress only once it has run this long, so quick reads don't flash. */
export const SYNC_DELAY_MS = 500;

/** Long layer-tree reads and their latest percent, from the main thread's `read-progress`. */
export class ReadProgressLog {
  private reads = new Map<string, { startedAt: number; percent: number | null }>();

  start(requestId: string, now: number): void {
    this.reads.set(requestId, { startedAt: now, percent: null });
  }

  progress(requestId: string, percent: number): void {
    const read = this.reads.get(requestId);
    if (read) read.percent = Math.min(100, Math.max(0, Math.floor(percent)));
  }

  finish(requestId: string): void {
    this.reads.delete(requestId);
  }

  clear(): void {
    this.reads.clear();
  }

  /** The lowest percent among reads past SYNC_DELAY_MS that have reported one, else null. */
  percent(now: number): number | null {
    let lowest: number | null = null;
    for (const { startedAt, percent } of this.reads.values()) {
      if (percent === null || now - startedAt < SYNC_DELAY_MS) continue;
      if (lowest === null || percent < lowest) lowest = percent;
    }
    return lowest;
  }

  /** Milliseconds until the next running read crosses SYNC_DELAY_MS, or null. */
  nextReveal(now: number): number | null {
    let next: number | null = null;
    for (const { startedAt } of this.reads.values()) {
      const left = startedAt + SYNC_DELAY_MS - now;
      if (left > 0 && (next === null || left < next)) next = left;
    }
    return next;
  }
}

/** The Selection row; `sentNow` adds the 04 suffix. */
export function selectionRowText(count: number, sentNow: boolean): string {
  const text = formatSelection(count);
  return sentNow ? `${text} · sent just now` : text;
}

/** True when both lists hold the same node ids, in any order. Nothing sent is never a match. */
export function sameNodes(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
