# Phase 3: Follower count

[← Overview](00-overview.md)

**Goal:** The leader knows how many followers are around and tells opted-in plugins. **Out:** any
dashboard or HTTP status endpoint (that is `feat/relay-dashboard`).

## Requirements

Overview rows 08 tracking and 08 delivery.

## Tasks

- [x] **1. Registry.** New `server/src/followers.ts`, test-first in `followers.test.ts`:
  ```ts
  export const FOLLOWER_STALE_MS = 60_000;
  export const INSTANCE_HEADER = "x-relay-instance";
  export const INSTANCE_ID = String(process.pid);
  export function readInstance(header: string | string[] | undefined): string | null; // /^\d{1,10}$/
  export class FollowerRegistry {
    constructor(now?: () => number);
    touch(instance: string | null): void;
    count(): number; // distinct instances seen within FOLLOWER_STALE_MS
  }
  ```
  Tests: bad headers → null; the same id twice counts once; an id older than 60 s drops out.
- [x] **2. Send the header.** `follower.ts` (both `/rpc` fetches and `ping`) and `election.ts`
      (`pingLeader`) send `[INSTANCE_HEADER]: INSTANCE_ID`.
- [x] **3. Leader.** `leader.ts` owns a `FollowerRegistry`; touches it on `/ping` and `/rpc`; every
      5 s and after each touch calls `bridge.setFollowerCount(registry.count())`. Clear the
      interval in `stop()`. Test in `leader.test.ts`: a `/ping` with the header raises the count
      the bridge sees; one without doesn't.
- [x] **4. Bridge.** `handleUpgrade` reads `relayStatus` from the query; the connection entry keeps
      `wantsStatus: boolean`. `setFollowerCount(n)` stores n and, if it changed, sends
      `{ type: "relay-status", followers: n }` to every entry with `wantsStatus`; a new
      `wantsStatus` connection gets the current status right after it is registered. Tests in
      `bridge.test.ts` with a real `ws` client: opted-in client gets the status on connect and on a
      change; a client without `relayStatus=1` gets nothing; no send when the count is unchanged.
- [x] **5.** `bun test`, `bun run build` in `server/`; commit `feat(server): count followers and push the count to the panel`.

## Notes

- Same names and header as `feat/relay-dashboard`'s `activity.ts`, so whichever branch merges
  second folds `followers.ts` into it with no behaviour change. The dashboard's registry also
  tracks call counts; this one doesn't need to.
- Never add CORS headers; `/ping` stays a plain GET.

## Acceptance

Tests and build pass; with `hold-leader.mjs` plus a probe running, the plugin receives
`relay-status` (phase 5).

## After merging `dev` (2026-10-19)

`feat/relay-dashboard` reached `dev` first with the same header and registry in
`server/src/activity.ts`. When `dev` was merged into this branch, `followers.ts` and its tests
were dropped: the leader now publishes `FollowerRegistry.active().length` from `activity.ts`
(touched on `/ping` and `/rpc` by the dashboard's code) after each touch and every 5 s. The
`relay-status` push and its bridge tests are unchanged.
