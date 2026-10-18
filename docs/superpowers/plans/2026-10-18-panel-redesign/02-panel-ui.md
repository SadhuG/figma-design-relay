# Phase 2: Panel UI

[← Overview](00-overview.md)

**Goal:** The light panel from Board 10 running in Figma for Stable and Dev builds, covering states
01, 02, 03 (as "Agent working") and 07, collapsed and open.

**In scope:** `plugin/dev-slot.ts`, `plugin/vite.config.ts`, `plugin/src/ui/*`, the window height
in `plugin/src/main/code.ts`.
**Out of scope:** the server, agent names (phase 3), the "Later" states, the dark theme.

**Depends on:** phase 1 (`panel-state.ts`).

## Requirements

All of the overview's decision table except Agent label names. The visual reference for each state
is the matching card in Board 10, section 1 (cards `01`, `02`, `03c`, `07`) and section 2 (cards
`A`, `B`).

## Review focus

1. **Stable build (no slot):** no Dev pill, sun icon, version shown. A Dev build must never show
   the version in place of the pill. Owned by Task 1's tests.
2. **A long file name** must stop 40 px from the right edge and truncate with an ellipsis, never
   running under the toggle. Owned by Task 3, checked live.
3. **Reopening the plugin while collapsed** must restore the 36 px bar without flashing the open
   panel. The existing `visible: false` start must survive. Owned by Task 5, checked live.
4. **Retry now pressed during an attempt** must not open two sockets. Owned by Task 4.
5. **The relay comes back on its own** must reset the retry schedule, so the next drop starts at
   1 s again. Owned by Task 4, checked live.

---

### Task 1: Build-time version and slot name

**Files:**

- Modify: `plugin/dev-slot.ts`, `plugin/vite.config.ts`, `plugin/src/ui/env.d.ts`
- Test: `plugin/dev-slot.test.ts`

**Interfaces:**

- Produces: `uiDefine(slot: DevSlot | null, version: string): Record<string, string>`. Its keys
  are `import.meta.env.VITE_FIGMA_DESIGN_RELAY_VERSION` (always),
  `import.meta.env.VITE_FIGMA_DESIGN_RELAY_SLOT` (slot only) and
  `import.meta.env.VITE_FIGMA_DESIGN_RELAY_WS` (slot only, the same value as today). Every value is
  `JSON.stringify`-ed. In the UI, `import.meta.env.VITE_FIGMA_DESIGN_RELAY_VERSION: string` and
  `VITE_FIGMA_DESIGN_RELAY_SLOT?: string`.

- [ ] **Step 1: Failing tests** in `dev-slot.test.ts`:
  - `uiDefine(null, "0.7.8")` equals
    `{ "import.meta.env.VITE_FIGMA_DESIGN_RELAY_VERSION": "\"0.7.8\"" }`.
  - `uiDefine({ name: "panel-redesign", port: 1999 }, "0.7.8")` has all three keys, with SLOT
    `"\"panel-redesign\""` and WS `"\"ws://localhost:1999/ws\""`.
- [ ] **Step 2: Run to see it fail.** Run `cd plugin && bun test dev-slot.test.ts`. Expected: FAIL,
      `uiDefine` not exported.
- [ ] **Step 3: Implement `uiDefine`.** In `vite.config.ts`, use
      `define: uiDefine(slot, pkg.version)`, where `pkg` is `./package.json`, and keep the existing
      contradiction check. Add both env fields to `env.d.ts`.
- [ ] **Step 4: Run to see it pass.** Run `cd plugin && bun test && bun run build`. Expected: PASS.
      `dist/index.html` contains `panel-redesign`.
- [ ] **Step 5: Commit** with `feat(plugin): bake version and dev slot name into the UI`.

### Task 2: Icons

**Files:**

- Create: `plugin/src/ui/icons.tsx`

**Interfaces:**

- Produces: `SunIcon`, `PlaneIcon`, `CursorIcon`, `LostIcon`, `ChevronIcon`. Each takes
  `{ size: number }`; `ChevronIcon` also takes `{ direction: "up" | "down" }`.

- [ ] **Step 1: Export the SVGs** from Board 10 with the relay's `save_screenshots` tool
      (`format: "SVG"`) into a scratch folder inside the worktree:
  - Stable app icon: `App icon` in card 01's footer.
  - Dev app icon: `App icon` in card 02's footer.
  - Working mark: the icon frame inside the state chip of card 03a.
  - Lost mark: the `moved` frame inside card 07's state chip.

  Find each node with `run_script` by name under that card.

- [ ] **Step 2: Inline them as React components.** Use `viewBox` and the `size` prop. Keep the
      fills from the export. `ChevronIcon` is `M 0 4.5 L 4.5 0 L 9 4.5` in a 9 × 4.5 box, 1.5 px
      `currentColor` stroke with round caps, rotated 180° for `down`. Delete the scratch folder.
- [ ] **Step 3: Verify.** Run `cd plugin && bun run typecheck`. Expected: 0 errors.
- [ ] **Step 4: Commit** with `feat(plugin): panel icons from Board 10`.

### Task 3: Panel layout and styles

**Files:**

- Modify: `plugin/src/ui/App.tsx` (the render and the status text), `plugin/src/ui/index.css`
  (rewrite)
- Delete: `plugin/src/ui/assets/hopp-logo.png`

**Interfaces:**

- Consumes: `formatSelection`, `relayAddress`, `relayRowText`, `relayPort`, `chipState`,
  `workingLabel` (phase 1), `uiDefine`'s env fields (Task 1), the icons (Task 2).

- [ ] **Step 1: Rewrite the markup.** Match Board 10, using these classes:
  - `.panel` for the open view: `.rows` (File, Selection, Relay) and `.footer` (app icon, chip,
    grow, then the version, the Dev pill or Retry now).
  - `.bar` for the collapsed view: app icon, grow, pill, chip.
  - One `.toggle` button outside both, placed absolutely at top 6, right 8, 24 px square.

  Sizes from Board 10: rows 11 px with 6 px gap, padding 14/40/10/12, and a 64 px label column
  with an 8 px gap. Footer: 8/12 padding, 8 px gap, top border `#e6e6e6`, 34 px tall. Chip: 11 px
  Medium, 2/7/2/6 padding, pill radius, 5 px gap, 6 px dot for live. Collapsed bar: 0/8/0/10
  padding, 10 px chip text. Everything else comes from the overview's colour table.

- [ ] **Step 2: Wire the toggle.** `title` and `aria-label` are "Collapse" when open and "Expand"
      when collapsed. `ChevronIcon direction` is `up` when open and `down` when collapsed.
- [ ] **Step 3: Wire the text.** For two or more agents, the chip's `title` lists them (phase 3
      fills in the names). The Relay row's value truncates with an ellipsis. The full
      `WS_BASE_URL` stays as the chip's `title` when no agent list is shown.
- [ ] **Step 4: Remove the Hopp link,** its import and the PNG.
- [ ] **Step 5: Verify.** Run `cd plugin && bun run build && bun test`. Expected: PASS, and
      `dist/index.html` no longer contains `hopp`.
- [ ] **Step 6: Commit** with `feat(plugin): light panel layout from Board 10`.

### Task 4: Reconnect schedule, Retry now and the working state

**Files:**

- Modify: `plugin/src/ui/App.tsx` (the socket effect)

**Interfaces:**

- Consumes: `retryDelayMs`, `ActivityLog`, `WORKING_WINDOW_MS` (phase 1).

- [ ] **Step 1: Retry schedule.** Keep an attempt counter in a ref. On close, schedule
      `retryDelayMs(attempt++)` and store the deadline. On open, reset the counter to 0. A 1 s
      interval updates `retryInSeconds` only while disconnected. Clear it on connect and on
      unmount.
- [ ] **Step 2: Retry now.** Clear the pending timer, reset the counter and call `connect()`.
      `connect()` already detaches and closes the previous socket, so a click mid-attempt replaces
      it rather than adding a second one. While an attempt is open, `retryInSeconds` is `0`.
- [ ] **Step 3: Activity.**
  - `ws.onmessage` calls `log.start(payload.requestId, null, Date.now())`.
  - The window `message` handler that forwards a response calls `log.finish(msg.requestId, Date.now())`.
  - `ws.onclose` calls `log.clear()`.

  After each change, re-render and set one timeout for `log.nextExpiry(now)`.

- [ ] **Step 4: Verify.** Run `cd plugin && bun run build`. Expected: PASS. The behaviour gets
      checked live in Task 6.
- [ ] **Step 5: Commit** with `feat(plugin): growing reconnect delay, Retry now and the working chip`.

### Task 5: Window height

**Files:**

- Modify: `plugin/src/main/code.ts` (`UI_EXPANDED_HEIGHT`)

- [ ] **Step 1: Change the height.** Set `UI_EXPANDED_HEIGHT = 113` and update its comment.
      `UI_COLLAPSED_HEIGHT` stays 36.
- [ ] **Step 2: Verify.** Run `cd plugin && bun run build`. Expected: PASS.
- [ ] **Step 3: Commit** with `feat(plugin): 113 px open panel`.

### Task 6: Live check and docs

- [ ] **Step 1: Build and relaunch.** Build both packages in the worktree, restart the
      `panel-redesign` relay and relaunch the Dev plugin.
- [ ] **Step 2: Check each state live** with the `live-figma-check` skill. Compare each state with
      its Board 10 card side by side:
  - Connected: card 02, as this is a Dev build.
  - A tool call through the dev MCP: card 03c, "Agent working" for about 10 s after the call.
  - The relay stopped: card 07, with the countdown counting 1, 2, 5, 10 and then 30 s, Retry now
    reconnecting at once, and the icon faded.
  - The relay restarted: it reconnects on its own and the next drop starts at 1 s.
  - Collapse and Expand: the chevron direction and labels, and the 36 px and 113 px sizes.
  - Reopening the plugin while collapsed: no flash.
  - A long file name: truncated before the toggle.
  - Selection 0, 1 and 3: the plural text.
- [ ] **Step 3: Check the Stable build.** Build the main checkout's plugin from this branch's
      `plugin/` into a scratch copy, or ask the user to check after the merge. Note in the PR that
      the sun icon and version appear without a slot.
- [ ] **Step 4: Record the results.** Write the tested commit, setup, cases and results in
      `docs/superpowers/plans/2026-10-18-panel-redesign/live-check.md`.
- [ ] **Step 5: Update the docs.** In the README, update any description of the panel and its
      screenshot. Refresh CLAUDE.md's plugin test count.
- [ ] **Step 6:** Run `finish-task`: version bump, separate-agent review, merge.

## Acceptance checks

- Every Task 6 case matches its Board 10 card.
- `bun test` and `bun run typecheck` in `plugin/` are clean.
- `git grep -i hopp plugin/` finds nothing.
- `UI_EXPANDED_HEIGHT` is 113.
