# Arranging existing nodes

Seven tools move or copy nodes that already exist, plus a batch form of `set_node_properties`. They
work in design files, FigJam and Slides — `fit_to_content` only where sections exist, design files
and FigJam — and never in Dev Mode.

## Coordinates and what is refused

Every position here is a node's `x`/`y`, relative to its parent. So the tools that relate nodes to
each other — `distribute_*`, `place_*` — need **siblings under one parent**: mixing parents would
mix coordinate systems. They also refuse:

- nodes whose parent uses **auto-layout**, since the parent places them (an absolutely positioned
  child of an auto-layout frame is fine) — change spacing with `set_auto_layout` instead;
- **rotated** nodes, since a rotated node's width and height are not its extent on the canvas;
- the same id twice, or a node placed relative to itself.

`align_to_grid` and `duplicate_with_offset` refuse auto-layout-placed nodes for the same reason. All
inputs are resolved and checked before the first node moves, so a refusal changes nothing.

## The tools

- **`distribute_horizontally` / `distribute_vertically`** — `{ nodeIds }`, at least three. The
  first and last node along the axis keep their exact positions; the ones between are moved so
  every gap between neighbouring edges is equal. The result gives `gap`, which is negative when the
  nodes overlap more than their span allows, and `movedCount`/`results` for the moved nodes only.
- **`align_to_grid`** — `{ nodeIds, gridSize }`. Rounds each `x` and `y` to the nearest multiple of
  `gridSize` (> 0).
- **`place_below` / `place_right_of`** — `{ nodeId, relativeToId, gap?, align? }`. Puts the node
  `gap` (default 0, never negative) below or right of the reference, lined up with its start edge
  (`align: "start"`, default) or centred on it (`"center"`).
- **`duplicate_with_offset`** — `{ nodeIds, offsetX, offsetY }`. Each copy lands beside its original,
  moved by the offset in that original's parent. If any copy fails, every copy the call made is
  removed. Returns each source id with its copy.
- **`fit_to_content`** — `{ nodeId, padding? }` on a SECTION. The section keeps its position; its
  children are moved so their bounding box starts at `padding`, and the section is resized to that
  box plus `padding` on every side. **The content moves on the canvas** — this is not a crop that
  keeps everything in place. Rotated children are refused; an empty section shrinks to twice the
  padding (at least 0.01). Frames are not supported; use `set_auto_layout` with hug sizing.

## Batches with `set_node_properties`

Pass `nodeIds` instead of `nodeId` to apply one patch to several nodes (if both are given, `nodeIds`
wins; a repeated id is applied once). Every node is found and every property checked against every
node before anything is written, so a missing id or, say, a corner radius on a FigJam
shape-with-text (read-only there) changes nothing. The Plugin API has no rollback, though: if Figma
itself rejects a value part-way through, the nodes already written keep their change. One node
returns `{ nodeId, nodeName, applied }` as before; several return `{ updatedCount, results }`.
