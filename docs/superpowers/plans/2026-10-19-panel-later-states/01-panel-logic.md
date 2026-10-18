# Phase 1: Panel logic

[← Overview](00-overview.md)

**Goal:** Every new text and timing rule as a pure, tested function in
`plugin/src/ui/panel-state.ts`. **Out:** React, CSS, the main thread, the server.

## Requirements

The overview's decision table: chip precedence, the 04/05/06/08 texts, the 10 s + 10 s Sent window,
the 60 s / next-call Diagram window, the 500 ms syncing delay, the selection row suffix.

## Tasks

- [x] **1. Chip state.** Extend `ChipTone` with `"syncing" | "diagram" | "sent" | "leader"` and
      `ChipInput` with `syncingPercent: number | null`, `notice: "diagram" | "sent" | null`,
      `followers: number`. Tests in `panel-state.test.ts` first:
  - syncing 62 → `Reading the layer tree… 62%` / `Syncing 62%`; syncing beats working and diagram.
  - diagram → `Diagram drawn on this page` / `Diagram drawn`; beats working.
  - sent → `Sent to your agent` / `Sent`; loses to working.
  - followers 2 → `Leader · 2 followers` / `Leader +2`; 1 → `Leader · 1 follower` / `Leader +1`;
    0 → the existing Live text; leader loses to sent.
  - lost and connecting still beat everything.
- [x] **2. `NoticeBoard`.** A class holding at most one notice per kind:
  ```ts
  type NoticeKind = "sent" | "diagram";
  type Notice = { kind: NoticeKind; requestId: string; nodeIds: string[] };
  class NoticeBoard {
    record(kind: NoticeKind, requestId: string, nodeIds: string[], now: number): void;
    requestStarted(requestId: string, now: number): void; // clears diagram unless it is its own request
    requestFinished(requestId: string, now: number): void; // starts / extends the expiry clocks
    dismiss(kind: NoticeKind): void;
    clear(): void; // socket closed
    current(now: number): { diagram: Notice | null; sent: Notice | null };
    nextExpiry(now: number): number | null;
  }
  export const SENT_WINDOW_MS = 10_000;
  export const DIAGRAM_WINDOW_MS = 60_000;
  ```
  Rules: `sent` has no expiry until a request finishes after it is recorded; each finish sets
  expiry to `max(expiry, now + WORKING_WINDOW_MS + SENT_WINDOW_MS)`. `diagram` expires
  `DIAGRAM_WINDOW_MS` after it is recorded, or as soon as a different request starts. A new record
  replaces the old notice of that kind. Events can arrive before or after their own response;
  `record` after `requestFinished` of the same id counts that finish (store finished ids for the
  current window). Tests: each rule, plus `nextExpiry` returning the nearest expiry.
- [x] **3. Syncing visibility.** `export const SYNC_DELAY_MS = 500;` and
      `class ReadProgressLog { start(id, now); progress(id, percent); finish(id); clear(); percent(now): number | null; nextReveal(now): number | null }`.
      `percent` returns the lowest percent among reads that started ≥ 500 ms ago and have reported
      one, else null; `nextReveal` is the ms until the next such read crosses 500 ms. Tests: before
      500 ms → null; after → percent; finished → null; percent is clamped to 0–100 and floored.
- [x] **4. Selection row.** `selectionRowText(count: number, sentNow: boolean): string` →
      `formatSelection(count)` plus ` · sent just now` when `sentNow`;
      `sameNodes(a: string[], b: string[]): boolean` (order-insensitive). Tests for both.
- [x] **5.** `bun test`, `bun run typecheck` in `plugin/`; commit `feat(plugin): panel rules for the later states`.

## Notes

- Keep `WORKING_WINDOW_MS`, `ActivityLog` and the existing texts unchanged; existing tests must pass.
- The tooltip stays `agentTooltip` for working and the WS URL otherwise.

## Acceptance

All new tests pass; `bun run typecheck` is clean.
