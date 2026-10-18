# Phase 2: Main thread events

[← Overview](00-overview.md)

**Goal:** The main thread tells the panel what the agent read and drew, and how far a long read
has got, and answers the panel's Show in canvas / Select it. **Out:** the panel's rendering.

## Requirements

Overview rows 04 trigger, 05 trigger, 06 trigger and "Panel ↔ main messages".

## Tasks

- [x] **1. Progress counter.** New `plugin/src/main/read-progress.ts`, test-first in
      `read-progress.test.ts`:
  ```ts
  type Countable = { visible?: boolean; children?: readonly Countable[] };
  export function countNodes(roots: readonly Countable[], maxDepth?: number): number;
  export const PROGRESS_INTERVAL_MS = 200;
  export function progressReporter(
    total: number,
    post: (percent: number) => void,
    now: () => number
  ): () => void; // call once per serialized node
  ```
  `countNodes` mirrors `serializeNode`: the root counts, children only if `visible !== false`, and
  no children past `maxDepth` (a node at depth `maxDepth` counts but its children don't). The
  reporter posts `Math.floor(done / total * 100)` (never above 100),
  only when the percent changed and at least 200 ms passed since the last post (the first
  post waits 200 ms too). `total` 0 never posts. Tests cover depth, hidden children, throttling,
  no-change suppression.
- [x] **2. Serializer hook.** Add `onNode?: () => void` to `SerializeOptions` in `serializer.ts`;
      call it once per node serialized. Test in `serializer.test.ts` that a two-child frame calls
      it three times and that hidden children don't count.
- [x] **3. Wire progress** in `code.ts` for `get_document`, `get_selection`, `get_node`,
      `get_design_context`: compute `total` with `countNodes` over the roots it will serialize (with
      the same `maxDepth`), make the reporter with
      `post = (percent) => figma.ui.postMessage({ type: "read-progress", requestId, percent })`,
      pass it as `onNode`.
- [x] **4. Panel events** in `code.ts`, posted before the response:
  - `selection-sent {requestId, nodeIds}` from `get_selection` (non-empty selection),
    `get_design_context` (no node id, non-empty selection) and `get_screenshot` (no node ids).
  - `diagram-drawn {requestId, nodeIds: createdNodeIds}` after a successful `render_diagram`.
- [x] **5. `show-nodes`.** In `figma.ui.onmessage`: `{type: "show-nodes", nodeIds, select}` →
      resolve ids with `getNodeByIdAsync`, keep scene nodes, switch to their page with
      `setCurrentPageAsync` if it isn't current, set `selection` when `select`, then
      `figma.viewport.scrollAndZoomIntoView(nodes)`. Missing nodes are skipped; none left → `figma.notify("Those layers are gone.")`.
- [x] **6. Selection ids.** `sendStatus` adds `selectionIds: figma.currentPage.selection.map((n) => n.id)`.
- [x] **7.** `bun test`, `bun run build` in `plugin/`; commit `feat(plugin): report reads, sent selections and drawn diagrams to the panel`.

## Notes

- The dispatcher test (`dispatcher.test.ts`) stubs `figma`; extend its stub with `ui.postMessage`
  if a case now calls it.
- Throttling keeps postMessage traffic to ≤ 5 messages a second per read.

## Acceptance

Tests pass; the build is clean; in Figma (phase 5) the panel receives the messages.
