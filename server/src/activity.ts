/**
 * What the leader remembers for the dashboard: the tool calls it sent to Figma
 * and the follower processes that talk to it. Memory only, never params or
 * results — a call's arguments can hold a whole run_script source.
 */

/** Where a tool call entered the leader. */
export type CallOrigin = { kind: "local" } | { kind: "follower"; instance: string | null };

export interface ActivityEntry {
  id: number;
  tool: string;
  fileKey: string | null;
  fileName: string | null;
  origin: CallOrigin;
  startedAt: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface FollowerSeen {
  instance: string;
  lastSeen: number;
  calls: number;
}

export const ACTIVITY_LIMIT = 200;
export const ERROR_TEXT_LIMIT = 300;
export const FOLLOWER_STALE_MS = 60_000;
export const FOLLOWER_LIMIT = 256;

/** Followers and the election name their process on every request to the leader. */
export const INSTANCE_HEADER = "x-relay-instance";
export const INSTANCE_ID = String(process.pid);

const INSTANCE_PATTERN = /^\d{1,10}$/;

/** Accept one numeric process label of at most ten digits; ignore missing or malformed headers. */
export function readInstance(header: string | string[] | undefined): string | null {
  return typeof header === "string" && INSTANCE_PATTERN.test(header) ? header : null;
}

/** Bounded history of settled calls, excluding arguments and results. */
export class ActivityLog {
  private entries: ActivityEntry[] = [];
  private nextId = 1;

  /** Configure retained entry count and the clock used for start times and durations. */
  constructor(
    private limit: number = ACTIVITY_LIMIT,
    private now: () => number = Date.now
  ) {}

  /**
   * Capture dispatch time and file identity; return an idempotent completion callback.
   * Omitting its error records success; supplying one records a truncated failure message.
   */
  start(
    tool: string,
    origin: CallOrigin,
    file: { fileKey: string; fileName: string } | null
  ): (error?: string) => void {
    const startedAt = this.now();
    let done = false;
    return (error) => {
      if (done) return;
      done = true;
      const entry: ActivityEntry = {
        id: this.nextId++,
        tool,
        fileKey: file?.fileKey ?? null,
        fileName: file?.fileName ?? null,
        origin,
        startedAt,
        durationMs: this.now() - startedAt,
        ok: error === undefined,
      };
      if (error !== undefined) {
        entry.error =
          error.length > ERROR_TEXT_LIMIT ? `${error.slice(0, ERROR_TEXT_LIMIT - 1)}…` : error;
      }
      this.entries.push(entry);
      if (this.entries.length > this.limit) this.entries.shift();
    };
  }

  /** Return a new array of retained entries, most recently completed first. */
  recent(): ActivityEntry[] {
    return [...this.entries].reverse();
  }
}

/** Bounded, least-recently-observed telemetry; labels never authorize or route requests. */
export class FollowerRegistry {
  private seen = new Map<string, FollowerSeen>();

  /** Use the supplied epoch-millisecond clock for refresh and expiry. */
  constructor(private now: () => number = Date.now) {}

  /** Expire stale telemetry on every observation, then refresh a label and count RPC requests. */
  touch(instance: string | null, isCall: boolean): void {
    const now = this.now();
    this.prune(now);
    if (instance === null) return;
    const entry = this.seen.get(instance) ?? { instance, lastSeen: 0, calls: 0 };
    entry.lastSeen = now;
    if (isCall) entry.calls++;
    // Map insertion order tracks observations, including ties in the clock.
    this.seen.delete(instance);
    this.seen.set(instance, entry);
    if (this.seen.size > FOLLOWER_LIMIT) {
      this.seen.delete(this.seen.keys().next().value!);
    }
  }

  /** Remove expired labels without requiring a dashboard snapshot or a background timer. */
  private prune(now: number): void {
    const cutoff = now - FOLLOWER_STALE_MS;
    for (const [instance, entry] of this.seen) {
      if (entry.lastSeen < cutoff) this.seen.delete(instance);
    }
  }

  /** Expire stale labels and return copies of active entries, most recently heard first. */
  active(): FollowerSeen[] {
    this.prune(this.now());
    return [...this.seen.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((entry) => ({ ...entry }));
  }
}
