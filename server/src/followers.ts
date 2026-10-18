// Which follower processes the leader has heard from, for the plugin panel's
// "Leader · 2 followers" chip. Followers never register; they name themselves
// on every /rpc call and on the election's /ping, which runs every 3–5 s.
//
// The names match feat/relay-dashboard's activity.ts, so whichever branch
// merges second folds this file into that one with no change in behaviour.

/** A follower not heard from for this long counts as gone. */
export const FOLLOWER_STALE_MS = 60_000;

/** Followers and the election name their process on every request to the leader. */
export const INSTANCE_HEADER = "x-relay-instance";
export const INSTANCE_ID = String(process.pid);

const INSTANCE_PATTERN = /^\d{1,10}$/;

export function readInstance(header: string | string[] | undefined): string | null {
  return typeof header === "string" && INSTANCE_PATTERN.test(header) ? header : null;
}

export class FollowerRegistry {
  private lastSeen = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

  touch(instance: string | null): void {
    if (instance !== null) this.lastSeen.set(instance, this.now());
  }

  /** Distinct followers heard from in the last FOLLOWER_STALE_MS. */
  count(): number {
    const cutoff = this.now() - FOLLOWER_STALE_MS;
    for (const [instance, seen] of this.lastSeen) {
      if (seen < cutoff) this.lastSeen.delete(instance);
    }
    return this.lastSeen.size;
  }
}
