# Phase 4: Panel UI

[← Overview](00-overview.md)

**Goal:** The four states on screen, matching Board 10's cards. **Out:** new rules (phase 1 holds
them all).

## Requirements

Overview decision table; the board cards for exact spacing and colours.

## Tasks

- [x] **1. Icons.** Export the chip icons as SVG from Board 10 and add them to `icons.tsx` as
      `SelectionIcon` (card 04 chip, frame `selection`), `LayersIcon` (`outlineStack`),
      `DiagramIcon` (`shapeRelay`), `DartsIcon` (`darts`). 14 px in the footer, 12 px collapsed,
      like the existing chip icons. Keep the board's two-colour treatment (`#1e1e1e` plus the tone).
- [x] **2. CSS** in `index.css`: chip tones `sent #ff4f1a`, `syncing #7c5cff`, `diagram #d62828`,
      `leader #3d5afe`, each text in the tone and background at 12% alpha, like the existing
      tones. `.button.primary-diagram` filled `#d62828`, white text, no border. Show in canvas uses
      the existing `.button`.
- [x] **3. Wiring** in `App.tsx`:
  - Hold a `NoticeBoard` and a `ReadProgressLog` in refs beside `ActivityLog`; feed them from
    `ws.onmessage` (request start), from responses (finish) and from the new main-thread
    messages; clear both when the socket closes.
  - One re-render timer for the nearest of `activity.nextExpiry`, `notices.nextExpiry`,
    `progress.nextReveal`.
  - `ws.onmessage`: a payload with `type === "relay-status"` sets `followers` and is not
    forwarded. Dial with `&relayStatus=1`. Reset `followers` to 0 on close.
  - Footer right slot per the overview. Show in canvas posts
    `{ type: "show-nodes", nodeIds, select: false }`; Select it posts `select: true` and dismisses
    the diagram notice.
  - The Selection row uses `selectionRowText(count, sentChipShowing && sameNodes(sent.nodeIds, status.selectionIds))`.
- [x] **4.** `bun run build`, `bun test` in `plugin/`, `bun run format`; commit `feat(plugin): show the later states in the panel`.

## Notes

- `ServerRequest` in `App.tsx` gains the `relay-status` shape; keep the existing request flow.
- The collapsed bar's Dev pill still gives way first when a chip is long.

## Acceptance

Build clean; in Figma (phase 5) each card matches the board.
