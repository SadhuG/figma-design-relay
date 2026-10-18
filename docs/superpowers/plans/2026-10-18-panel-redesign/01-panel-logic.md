# Phase 1: Panel logic

[← Overview](00-overview.md)

**Goal:** Every text and timing rule of the new panel as pure functions, tested, before any UI
changes.

**In scope:** `plugin/src/ui/panel-state.ts` and its test file.
**Out of scope:** React, CSS, the main thread, the server, and agent display names (phase 3).

**Depends on:** nothing.

## Requirements

The overview's decision table: Relay row, Selection row, State chip, Agent label (without names)
and Reconnect.

## Review focus

Conditions no single test below obviously owns. Each one has a test in the task named.

1. A request that runs longer than 10 s (a big `run_script`) must still count as working while it
   runs. Owned by Task 3.
2. The socket closes while requests are in flight, so their responses never arrive. "Working" must
   not stick forever. Owned by Task 3 (`clear`).
3. The relay URL can't be parsed (a hand-set `VITE_FIGMA_DESIGN_RELAY_WS`). The Relay row shows
   the raw value; it must not throw. Owned by Task 1.
4. The countdown reaches 0 while an attempt is still connecting. The chip must say "retrying…",
   not "retrying in 0 s". Owned by Task 2.
5. A response arrives for a request id the log never saw. It must be ignored. Owned by Task 3.

---

### Task 1: Row text

**Files:**

- Create: `plugin/src/ui/panel-state.ts`
- Test: `plugin/src/ui/panel-state.test.ts`

**Interfaces:**

- Produces: `formatSelection(count: number): string`, `relayAddress(wsUrl: string): string`,
  `relayRowText(address: string, connected: boolean): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { formatSelection, relayAddress, relayRowText } from "./panel-state";

describe("formatSelection", () => {
  test("zero", () => expect(formatSelection(0)).toBe("Nothing selected"));
  test("one", () => expect(formatSelection(1)).toBe("1 node"));
  test("many", () => expect(formatSelection(3)).toBe("3 nodes"));
});

describe("relayAddress", () => {
  test("keeps the connection type, drops the path", () =>
    expect(relayAddress("ws://localhost:1994/ws")).toBe("ws://localhost:1994"));
  test("dev slot port", () =>
    expect(relayAddress("ws://localhost:1999/ws")).toBe("ws://localhost:1999"));
  test("unparseable input comes back as is", () =>
    expect(relayAddress("not a url")).toBe("not a url"));
});

describe("relayRowText", () => {
  test("connected", () =>
    expect(relayRowText("ws://localhost:1994", true)).toBe("ws://localhost:1994"));
  test("disconnected", () =>
    expect(relayRowText("ws://localhost:1994", false)).toBe("ws://localhost:1994 (no answer)"));
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd plugin && bun test src/ui/panel-state.test.ts`
Expected: FAIL, module `./panel-state` not found.

- [ ] **Step 3: Implement the three functions**

`relayAddress` returns `` `${url.protocol}//${url.host}` `` from `new URL(...)`, and the input on
a parse error. Export the port too: `relayPort(wsUrl: string): string`, meaning `url.port`, or
`""` on a parse error. Task 2 and phase 2 use it, so add a test for both cases.

- [ ] **Step 4: Run to see it pass**

Run: `cd plugin && bun test src/ui/panel-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/ui/panel-state.ts plugin/src/ui/panel-state.test.ts
git commit -m "feat(plugin): panel row text helpers"
```

### Task 2: State chip and reconnect delays

**Files:**

- Modify: `plugin/src/ui/panel-state.ts`
- Test: `plugin/src/ui/panel-state.test.ts`

**Interfaces:**

- Consumes: `relayPort` from Task 1.
- Produces:
  - `RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000] as const`
  - `retryDelayMs(attempt: number): number`, where attempt 0 is the first retry and anything past
    the end returns 30000.
  - `type ChipTone = "live" | "working" | "lost"`
  - `type ChipInput = { connected: boolean; port: string; workingLabel: string | null; retryInSeconds: number | null }`
  - `chipState(input: ChipInput): { tone: ChipTone; text: string; short: string }`. `text` is
    for the open panel, `short` for the collapsed bar.

- [ ] **Step 1: Write the failing tests**

```ts
describe("retryDelayMs", () => {
  test("follows the schedule", () =>
    expect([0, 1, 2, 3, 4].map(retryDelayMs)).toEqual([1000, 2000, 5000, 10000, 30000]));
  test("stays at 30 s", () => expect(retryDelayMs(12)).toBe(30000));
});

describe("chipState", () => {
  const base = { connected: true, port: "1994", workingLabel: null, retryInSeconds: null };
  test("live", () =>
    expect(chipState(base)).toEqual({
      tone: "live",
      text: "Live on port 1994",
      short: "Live · 1994",
    }));
  test("working", () =>
    expect(chipState({ ...base, workingLabel: "Agent working" })).toEqual({
      tone: "working",
      text: "Agent working",
      short: "Agent working",
    }));
  test("lost with countdown", () =>
    expect(chipState({ ...base, connected: false, retryInSeconds: 5 })).toEqual({
      tone: "lost",
      text: "Lost the relay · retrying in 5 s",
      short: "Retrying…",
    }));
  test("lost mid-attempt", () =>
    expect(chipState({ ...base, connected: false, retryInSeconds: 0 }).text).toBe(
      "Lost the relay · retrying…"
    ));
  test("lost beats working", () =>
    expect(
      chipState({ ...base, connected: false, workingLabel: "Agent working", retryInSeconds: null })
        .tone
    ).toBe("lost"));
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd plugin && bun test src/ui/panel-state.test.ts`
Expected: FAIL, `retryDelayMs` / `chipState` not exported.

- [ ] **Step 3: Implement**

`retryInSeconds` of `null` or `0` both give the "retrying…" text.

- [ ] **Step 4: Run to see it pass**

Run: `cd plugin && bun test src/ui/panel-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/ui/panel-state.ts plugin/src/ui/panel-state.test.ts
git commit -m "feat(plugin): state chip text and reconnect schedule"
```

### Task 3: Activity log and the working label

**Files:**

- Modify: `plugin/src/ui/panel-state.ts`
- Test: `plugin/src/ui/panel-state.test.ts`

**Interfaces:**

- Produces:
  - `WORKING_WINDOW_MS = 10_000`
  - `class ActivityLog` with `start(requestId: string, agent: string | null, now: number): void`,
    `finish(requestId: string, now: number): void`, `clear(): void`,
    `activeAgents(now: number): (string | null)[]` (distinct, in first-seen order), and
    `nextExpiry(now: number): number | null` (ms until the oldest finished entry leaves the
    window, so the UI can schedule one re-render instead of polling).
  - `workingLabel(agents: (string | null)[]): string | null`. `[]` gives `null`. One agent gives
    `<agent> is working`, or `Agent working` for `null`. Two or more give `<n> agents working`.
    Phase 3 changes what `<agent>` is; the label rules stay.

- [ ] **Step 1: Write the failing tests**

```ts
describe("ActivityLog", () => {
  test("in-flight request counts however long it runs", () => {
    const log = new ActivityLog();
    log.start("1", null, 0);
    expect(log.activeAgents(60_000)).toEqual([null]);
  });
  test("finished request counts for 10 s, then drops", () => {
    const log = new ActivityLog();
    log.start("1", null, 0);
    log.finish("1", 1_000);
    expect(log.activeAgents(10_999)).toEqual([null]);
    expect(log.activeAgents(11_000)).toEqual([]);
  });
  test("distinct agents", () => {
    const log = new ActivityLog();
    log.start("1", "claude-code", 0);
    log.start("2", "claude-code", 0);
    log.start("3", "cursor-vscode", 0);
    expect(log.activeAgents(1)).toEqual(["claude-code", "cursor-vscode"]);
  });
  test("unknown request id is ignored", () => {
    const log = new ActivityLog();
    log.finish("nope", 0);
    expect(log.activeAgents(0)).toEqual([]);
  });
  test("clear drops in-flight requests", () => {
    const log = new ActivityLog();
    log.start("1", null, 0);
    log.clear();
    expect(log.activeAgents(1)).toEqual([]);
  });
  test("nextExpiry", () => {
    const log = new ActivityLog();
    log.start("1", null, 0);
    expect(log.nextExpiry(0)).toBeNull();
    log.finish("1", 2_000);
    expect(log.nextExpiry(5_000)).toBe(7_000);
  });
});

describe("workingLabel", () => {
  test("idle", () => expect(workingLabel([])).toBeNull());
  test("unnamed", () => expect(workingLabel([null])).toBe("Agent working"));
  test("named", () => expect(workingLabel(["Claude Code"])).toBe("Claude Code is working"));
  test("two", () => expect(workingLabel(["Claude Code", null])).toBe("2 agents working"));
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd plugin && bun test src/ui/panel-state.test.ts`
Expected: FAIL, `ActivityLog` not exported.

- [ ] **Step 3: Implement**

Keep one map from request id to `{ agent, finishedAt: number | null }`. Prune finished entries
older than the window inside `activeAgents`.

- [ ] **Step 4: Run to see it pass, then the whole plugin suite**

Run: `cd plugin && bun test && bun run typecheck`
Expected: every test passes, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/ui/panel-state.ts plugin/src/ui/panel-state.test.ts
git commit -m "feat(plugin): activity window for the working state"
```

## Acceptance checks

- `cd plugin && bun test` passes, including every test above.
- `bun run typecheck` reports zero errors.
- `panel-state.ts` imports nothing from React or the DOM.
