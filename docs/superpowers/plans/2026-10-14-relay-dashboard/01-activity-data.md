# Phase 1 — Activity data

[← Overview](00-overview.md)

## Goal and scope

Give the leader the facts the dashboard shows: a log of the tool calls it sent to Figma, when each
file connected, and which follower processes are talking to it.

**In:** `server/src/activity.ts`, call recording in `Bridge`, the instance header on follower and
election requests, follower tracking in `Leader`. **Out:** any HTTP route or page (Phases 2–3).

## Requirements

D2 (connected time), D3 (call log), D4 (followers), D6 (what is logged), D11 (no behaviour change).

## Dependencies

None. Run `start-feature` first (slug `relay-dashboard`); all commands run from the worktree.

## Implementation notes

- Recording lives in `Bridge.sendWithParams`, the one choke point for both local and follower calls.
  It wraps the promise's `resolve`/`reject`, so every exit path (plugin answer, plugin error,
  timeout, disconnect, send failure, no file) records exactly once.
- `resolveConnection` changes to return the `ConnectionEntry` (it is private; only
  `sendWithParams` calls it) so the log gets the file name.
- `listConnectedFiles()` keeps its exact shape: it is the `list_files` tool's output. Connection
  times go through a new `describeConnections()`.
- The origin is a new optional 6th parameter of `Bridge.sendWithParams`, after the existing
  optional `agent` parameter, defaulting to `{ kind: "local" }`, so `Node` and every existing
  caller stay unchanged.

## Tasks

### Task 1: ActivityLog and FollowerRegistry [D3, D4, D6]

**Files:**

- Create: `server/src/activity.ts`
- Test: `server/src/activity.test.ts`

**Interfaces:**

- Produces: `CallOrigin`, `ActivityEntry`, `FollowerSeen` (shapes in the overview);
  `ACTIVITY_LIMIT = 200`; `ERROR_TEXT_LIMIT = 300`; `FOLLOWER_STALE_MS = 60_000`;
  `FOLLOWER_LIMIT = 256`;
  `INSTANCE_HEADER = "x-relay-instance"`; `INSTANCE_ID: string` (this process's pid);
  `readInstance(header: string | string[] | undefined): string | null`;
  `class ActivityLog { constructor(limit?: number, now?: () => number); start(tool: string, origin: CallOrigin, file: { fileKey: string; fileName: string } | null): (error?: string) => void; recent(): ActivityEntry[] }`;
  `class FollowerRegistry { constructor(now?: () => number); touch(instance: string | null, isCall: boolean): void; active(): FollowerSeen[] }`.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  ActivityLog,
  ERROR_TEXT_LIMIT,
  FOLLOWER_STALE_MS,
  FollowerRegistry,
  readInstance,
} from "./activity.js";

function clock(start = 1_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => void (time += ms) };
}

describe("ActivityLog", () => {
  test("records a finished call with its duration, newest first", () => {
    const c = clock();
    const log = new ActivityLog(200, c.now);
    const first = log.start("get_node", { kind: "local" }, { fileKey: "k", fileName: "Screen" });
    c.advance(40);
    first();
    log.start(
      "get_selection",
      { kind: "follower", instance: "4242" },
      null
    )("No plugin connected.");
    expect(log.recent()).toEqual([
      {
        id: 2,
        tool: "get_selection",
        fileKey: null,
        fileName: null,
        origin: { kind: "follower", instance: "4242" },
        startedAt: 1_040,
        durationMs: 0,
        ok: false,
        error: "No plugin connected.",
      },
      {
        id: 1,
        tool: "get_node",
        fileKey: "k",
        fileName: "Screen",
        origin: { kind: "local" },
        startedAt: 1_000,
        durationMs: 40,
        ok: true,
      },
    ]);
  });

  test("keeps only the newest entries once full", () => {
    const log = new ActivityLog(3);
    for (let i = 0; i < 5; i++) log.start(`tool_${i}`, { kind: "local" }, null)();
    expect(log.recent().map((entry) => entry.tool)).toEqual(["tool_4", "tool_3", "tool_2"]);
  });

  test("shortens long error text", () => {
    const log = new ActivityLog();
    log.start("run_script", { kind: "local" }, null)("x".repeat(5_000));
    const [entry] = log.recent();
    expect(entry.error).toHaveLength(ERROR_TEXT_LIMIT);
    expect(entry.error!.endsWith("…")).toBe(true);
  });

  test("records a call once even if it is finished twice", () => {
    const log = new ActivityLog();
    const finish = log.start("get_node", { kind: "local" }, null);
    finish();
    finish("late timeout");
    expect(log.recent()).toHaveLength(1);
    expect(log.recent()[0].ok).toBe(true);
  });
});

describe("FollowerRegistry", () => {
  test("bounds distinct follower observations without dashboard reads", () => {
    const c = clock();
    const registry = new FollowerRegistry(c.now);
    for (let i = 0; i < 300; i++) registry.touch(String(i), false);
    const active = registry.active();
    expect(active).toHaveLength(256);
    expect(active.some((entry) => entry.instance === "0")).toBe(false);
    expect(active.some((entry) => entry.instance === "299")).toBe(true);
  });

  test("expires a stale returning follower on observation without a prior snapshot", () => {
    const c = clock();
    const registry = new FollowerRegistry(c.now);
    registry.touch("4242", true);
    c.advance(FOLLOWER_STALE_MS + 1);
    registry.touch("4242", false);
    expect(registry.active()).toEqual([{ instance: "4242", lastSeen: c.now(), calls: 0 }]);
  });

  test("evicts the least recently observed label and preserves refreshed call counts", () => {
    const c = clock();
    const registry = new FollowerRegistry(c.now);
    for (let i = 0; i < 256; i++) registry.touch(String(i), true);
    c.advance(1);
    registry.touch("0", true);
    registry.touch("256", false);
    const active = registry.active();
    expect(active).toHaveLength(256);
    expect(active.find((entry) => entry.instance === "0")?.calls).toBe(2);
    expect(active.some((entry) => entry.instance === "1")).toBe(false);
    expect(active.some((entry) => entry.instance === "256")).toBe(true);
  });

  test("counts calls and forgets followers silent for a minute", () => {
    const c = clock();
    const registry = new FollowerRegistry(c.now);
    registry.touch("4242", false);
    registry.touch("4242", true);
    registry.touch("5151", true);
    c.advance(FOLLOWER_STALE_MS - 1);
    registry.touch("5151", false);
    c.advance(2);
    expect(registry.active()).toEqual([
      { instance: "5151", lastSeen: 1_000 + FOLLOWER_STALE_MS - 1, calls: 1 },
    ]);
  });

  test("ignores requests without an instance", () => {
    const registry = new FollowerRegistry();
    registry.touch(null, true);
    expect(registry.active()).toEqual([]);
  });
});

describe("readInstance", () => {
  test("accepts a process id and nothing else", () => {
    expect(readInstance("4242")).toBe("4242");
    expect(readInstance("abc")).toBeNull();
    expect(readInstance("")).toBeNull();
    expect(readInstance("12345678901")).toBeNull();
    expect(readInstance(["4242"])).toBeNull();
    expect(readInstance(undefined)).toBeNull();
  });
});
```

- [x] **Step 2: Run the tests and see them fail**

Run: `cd server && bun test src/activity.test.ts`
Expected: FAIL — `Cannot find module './activity.js'`.

- [x] **Step 3: Implement `server/src/activity.ts`**

```ts
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

export function readInstance(header: string | string[] | undefined): string | null {
  return typeof header === "string" && INSTANCE_PATTERN.test(header) ? header : null;
}

export class ActivityLog {
  private entries: ActivityEntry[] = [];
  private nextId = 1;

  constructor(
    private limit: number = ACTIVITY_LIMIT,
    private now: () => number = Date.now
  ) {}

  /** Call as the request leaves; call the returned function once it settles. */
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

  /** Newest first. */
  recent(): ActivityEntry[] {
    return [...this.entries].reverse();
  }
}

export class FollowerRegistry {
  private seen = new Map<string, FollowerSeen>();

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

  /** Followers heard from in the last minute, most recent first. */
  active(): FollowerSeen[] {
    this.prune(this.now());
    return [...this.seen.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((entry) => ({ ...entry }));
  }
}
```

- [x] **Step 4: Run the tests and see them pass**

Run: `cd server && bun test src/activity.test.ts`
Expected: PASS, 10 tests.

- [x] **Step 5: Commit**

```bash
git add server/src/activity.ts server/src/activity.test.ts
git commit -m "feat(server): in-memory activity log and follower registry"
```

### Task 2: The bridge records every call [D2, D3, D6, D11]

**Files:**

- Modify: `server/src/bridge.ts` (`ConnectionEntry`, constructor, `handleConnection`,
  `resolveConnection`, `sendWithParams`; add `getActivity`, `describeConnections`)
- Test: `server/src/bridge.test.ts` (append)

**Interfaces:**

- Consumes: `ActivityLog`, `CallOrigin` from Task 1.
- Produces: `new Bridge(activity?: ActivityLog)`; `Bridge.getActivity(): ActivityLog`;
  `Bridge.describeConnections(): Array<ConnectedFile & { connectedAt: number; lastCallAt?: number }>`;
  `Bridge.sendWithParams(requestType, nodeIds?, params?, fileKey?, agent?, origin: CallOrigin = { kind: "local" })`.

- [x] **Step 1: Append the failing tests to `server/src/bridge.test.ts`**

```ts
test("records each call's tool, file, origin and outcome", async () => {
  const target = await connect("target");
  target.on("message", (data) => {
    const request = JSON.parse(data.toString());
    const reply =
      request.type === "get_node"
        ? { ...request, data: "ok" }
        : { ...request, error: "Node not found" };
    target.send(JSON.stringify(reply));
  });
  const bridge = leader.getBridge();
  await bridge.send("get_node", ["1:1"], "target");
  await bridge.sendWithParams("get_screenshot", ["9:9"], undefined, "target", undefined, {
    kind: "follower",
    instance: "4242",
  });
  const [failed, passed] = bridge.getActivity().recent();
  expect(passed).toMatchObject({
    tool: "get_node",
    fileKey: "target",
    fileName: "Unknown",
    origin: { kind: "local" },
    ok: true,
  });
  expect(failed).toMatchObject({
    tool: "get_screenshot",
    origin: { kind: "follower", instance: "4242" },
    ok: false,
    error: "Node not found",
  });
});

test("records a call that could not find its file", async () => {
  const bridge = leader.getBridge();
  await expect(bridge.send("get_node", ["1:1"], "missing")).rejects.toThrow("No plugin connected");
  expect(bridge.getActivity().recent()[0]).toMatchObject({
    tool: "get_node",
    fileKey: null,
    fileName: null,
    ok: false,
  });
});

test("records a call whose plugin disconnected mid-request", async () => {
  const target = await connect("target");
  target.once("message", () => target.close());
  const bridge = leader.getBridge();
  await expect(bridge.send("get_node", ["1:1"], "target")).rejects.toThrow("Plugin disconnected");
  expect(bridge.getActivity().recent()[0]).toMatchObject({ fileKey: "target", ok: false });
});

test("describes each connection with when it connected, list_files unchanged", async () => {
  const before = Date.now();
  await connect("target");
  const bridge = leader.getBridge();
  const [file] = bridge.describeConnections();
  expect(file.fileKey).toBe("target");
  expect(file.connectedAt).toBeGreaterThanOrEqual(before);
  expect(bridge.listConnectedFiles()).toEqual([{ fileKey: "target", fileName: "Unknown" }]);
});

test("lastCallAt reflects receipt while calls run and cannot regress on completion", async () => {
  const target = await connect("target");
  const bridge = leader.getBridge();
  const firstReceived = new Promise<BridgeRequest>((resolve) =>
    target.once("message", (data) => resolve(JSON.parse(data.toString())))
  );
  const first = bridge.send("get_selection", undefined, "target");
  const a = await firstReceived;
  const firstTime = bridge.describeConnections()[0].lastCallAt;
  await Bun.sleep(2);
  const secondReceived = new Promise<BridgeRequest>((resolve) =>
    target.once("message", (data) => resolve(JSON.parse(data.toString())))
  );
  const second = bridge.send("get_selection", undefined, "target");
  const b = await secondReceived;
  const whileRunning = bridge.describeConnections()[0].lastCallAt;
  target.send(JSON.stringify({ ...b, data: "second" }));
  await second;
  target.send(JSON.stringify({ ...a, data: "first" }));
  await first;
  expect(firstTime).toBeNumber();
  expect(whileRunning).toBeGreaterThan(firstTime!);
  expect(bridge.describeConnections()[0].lastCallAt).toBe(whileRunning);
  expect(bridge.listConnectedFiles()).toEqual([{ fileKey: "target", fileName: "Unknown" }]);
});

test("a file's lastCallAt survives other files evicting its activity entry", async () => {
  const target = await connect("target");
  const other = await connect("other");
  const bridge = leader.getBridge();
  const received = nextRequest(target);
  await bridge.send("get_selection", undefined, "target");
  await received;
  const lastCallAt = bridge
    .describeConnections()
    .find((file) => file.fileKey === "target")!.lastCallAt;
  other.on("message", (data) => {
    const request = JSON.parse(data.toString());
    other.send(JSON.stringify({ ...request, data: "ok" }));
  });
  for (let i = 0; i < 201; i++) await bridge.send("get_selection", undefined, "other");
  expect(
    bridge
      .getActivity()
      .recent()
      .some((entry) => entry.fileKey === "target")
  ).toBe(false);
  expect(lastCallAt).toBeNumber();
  expect(bridge.describeConnections().find((file) => file.fileKey === "target")!.lastCallAt).toBe(
    lastCallAt
  );
});
```

The file's existing `nextRequest` helper answers the target's request; add
`import type { BridgeRequest } from "./types.js";` to its imports.

- [x] **Step 2: Run the tests and see them fail**

Run: `cd server && bun test src/bridge.test.ts`
Expected: FAIL — `bridge.getActivity is not a function` (and `describeConnections`). The two
existing tests still pass.

- [x] **Step 3: Implement in `server/src/bridge.ts`**

Imports:

```ts
import { ActivityLog } from "./activity.js";
import type { CallOrigin } from "./activity.js";
```

`ConnectionEntry` gains `connectedAt: number;` and `lastCallAt?: number;`, and `handleConnection`
sets `connectedAt: Date.now(),` in the object it stores.

The constructor takes the log, and two accessors join `listConnectedFiles`:

```ts
  constructor(private activity: ActivityLog = new ActivityLog()) {
```

```ts
  getActivity(): ActivityLog {
    return this.activity;
  }

  /** list_files plus when each file connected and last got a call — for the dashboard, not the tool. */
  describeConnections(): Array<ConnectedFile & { connectedAt: number; lastCallAt?: number }> {
    return [...this.connections.values()].map((entry) => ({
      fileKey: entry.fileKey,
      fileName: entry.fileName,
      ...(entry.editorType ? { editorType: entry.editorType } : {}),
      connectedAt: entry.connectedAt,
      ...(entry.lastCallAt === undefined ? {} : { lastCallAt: entry.lastCallAt }),
    }));
  }
```

`resolveConnection` returns the entry: change its signature to
`private resolveConnection(fileKey?: string): ConnectionEntry` and both `return entry.ws;` lines to
`return entry;`.

Replace the top of `sendWithParams`, up to and including the `readyState` check, with the
following. It also stamps the connection's `lastCallAt` as the request leaves:

```ts
  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    fileKey?: string,
    agent?: string,
    origin: CallOrigin = { kind: "local" }
  ): Promise<BridgeResponse> {
    return new Promise((resolveCall, rejectCall) => {
      let entry: ConnectionEntry;
      try {
        entry = this.resolveConnection(fileKey);
      } catch (err) {
        this.activity.start(requestType, origin, null)((err as Error).message);
        rejectCall(err);
        return;
      }

      // Every way this promise settles goes through these two, so each call is
      // logged exactly once, timeouts and disconnects included.
      const finish = this.activity.start(requestType, origin, {
        fileKey: entry.fileKey,
        fileName: entry.fileName,
      });
      const resolve = (resp: BridgeResponse): void => {
        finish(resp.error);
        resolveCall(resp);
      };
      const reject = (err: Error): void => {
        finish(err.message);
        rejectCall(err);
      };
      const conn = entry.ws;

      if (conn.readyState !== WebSocket.OPEN) {
        reject(new Error("Plugin not connected"));
        return;
      }

      // Connection state outlives the bounded completed-call log, and updates
      // when a request leaves rather than when concurrent calls finish.
      entry.lastCallAt = Date.now();
```

The rest of the method is unchanged; it already calls `resolve`/`reject` by those names.

- [x] **Step 4: Run the server suite and the type-check**

Run: `cd server && bun test && bun run build`
Expected: all tests PASS (the six new ones included); `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
git add server/src/bridge.ts server/src/bridge.test.ts
git commit -m "feat(server): the bridge logs every tool call and when each file connected"
```

### Task 3: Followers name themselves; the leader tracks them [D3, D4]

**Files:**

- Modify: `server/src/follower.ts` (all three `fetch` calls), `server/src/election.ts`
  (`pingLeader`), `server/src/leader.ts` (`/ping`, `handleRPC`)
- Test: `server/src/leader.test.ts` (append)

**Interfaces:**

- Consumes: `FollowerRegistry`, `readInstance`, `INSTANCE_HEADER`, `INSTANCE_ID`, `CallOrigin`.
- Produces: `Leader.getFollowers(): FollowerRegistry`.

- [x] **Step 1: Append the failing tests to `server/src/leader.test.ts`**

Add `import { INSTANCE_HEADER, INSTANCE_ID } from "./activity.js";` and
`import { Follower } from "./follower.js";` to the imports, then:

```ts
describe("follower tracking", () => {
  let leader: Leader;
  let base: string;

  beforeAll(async () => {
    leader = new Leader(0);
    await leader.start();
    base = `http://127.0.0.1:${leader.address()!.port}`;
  });

  afterAll(() => {
    leader.stop();
  });

  test("remembers a follower by its instance header on /ping and /rpc", async () => {
    await fetch(`${base}/ping`, { headers: { [INSTANCE_HEADER]: "4242" } });
    await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [INSTANCE_HEADER]: "4242" },
      body: JSON.stringify({ tool: "list_files" }),
    });
    await fetch(`${base}/ping`);
    expect(leader.getFollowers().active()).toContainEqual({
      instance: "4242",
      lastSeen: expect.any(Number),
      calls: 1,
    });
  });

  test("logs a follower's tool call under that follower", async () => {
    await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [INSTANCE_HEADER]: "5151" },
      body: JSON.stringify({ tool: "get_node", nodeIds: ["1:1"], fileKey: "missing" }),
    });
    expect(leader.getBridge().getActivity().recent()[0]).toMatchObject({
      tool: "get_node",
      origin: { kind: "follower", instance: "5151" },
      ok: false,
    });
  });

  test("a Follower sends this process's id", async () => {
    expect(await new Follower(base).ping()).toBe(true);
    expect(
      leader
        .getFollowers()
        .active()
        .map((f) => f.instance)
    ).toContain(INSTANCE_ID);
  });
});
```

- [x] **Step 2: Run the tests and see them fail**

Run: `cd server && bun test src/leader.test.ts`
Expected: FAIL — `leader.getFollowers is not a function`.

- [x] **Step 3: Implement**

`server/src/follower.ts` — import `{ INSTANCE_HEADER, INSTANCE_ID }` from `./activity.js`, add
`[INSTANCE_HEADER]: INSTANCE_ID` to the `headers` of the `sendWithParams` and `listConnectedFiles`
fetches, and give `ping`'s fetch `headers: { [INSTANCE_HEADER]: INSTANCE_ID },`.

`server/src/election.ts` — same import; `pingLeader`'s fetch gets
`headers: { [INSTANCE_HEADER]: INSTANCE_ID },` beside its `signal`.

`server/src/leader.ts`:

```ts
import { FollowerRegistry, INSTANCE_HEADER, readInstance } from "./activity.js";
import type { CallOrigin } from "./activity.js";
```

```ts
  private followers = new FollowerRegistry();

  getFollowers(): FollowerRegistry {
    return this.followers;
  }
```

In the `/ping` branch, before `writeHead`:

```ts
this.followers.touch(readInstance(req.headers[INSTANCE_HEADER]), false);
```

At the top of `handleRPC`, before reading the body:

```ts
const instance = readInstance(req.headers[INSTANCE_HEADER]);
this.followers.touch(instance, true);
const origin: CallOrigin = { kind: "follower", instance };
```

Pass `origin` as the sixth argument to both `this.bridge.sendWithParams(…)` calls in `handleRPC`
(the `save_screenshots` sender and the general forward), preserving `agent` as the fifth argument.

- [x] **Step 4: Run the server suite and the type-check**

Run: `cd server && bun test && bun run build`
Expected: all tests PASS; `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
git add server/src/follower.ts server/src/election.ts server/src/leader.ts server/src/leader.test.ts
git commit -m "feat(server): followers send their process id and the leader tracks them"
```

## Acceptance checks

- `cd server && bun test` passes with 14 more tests than before; `bun run build` exits 0.
- `git diff main -- server/src/leader.test.ts` shows only appended tests: the `list_files` and
  `/rpc` guard tests are untouched (D11).
- Grep `server/src/activity.ts`: no field holds `params`, `nodeIds` or `data` (D6).
