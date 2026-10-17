# Reading prototypes

Three read-only entry points describe a design file's prototype exactly as Figma stores it. They run
in design files and Dev Mode; FigJam boards and Slides decks have no prototypes, so there they are
refused before anything is read. Nothing here plays the prototype: conditions are returned as
written and never evaluated.

| Tool                                     | Answers                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| `get_prototype_connections`              | Which interactions exist under this node or page?               |
| `trace_prototype_flow`                   | Which screens can a user reach from this one, and by what?      |
| `get_node` with `includePrototype: true` | The node as usual, plus the same scan under a `prototype` field |

Plain `get_node` is unchanged and works in every editor.

## `get_prototype_connections`

`{ nodeId?, maxNodes?, includeEmpty?, fileKey? }`. Scans the node and every descendant, including
instance sublayers (`I…;…` ids, flagged `instanceSublayer: true`). Omit `nodeId` to scan the current
page; a page id scans that page, loading it first. The document root is refused.

Each connection carries the node, its `path` of layer names from its screen down, its `screen`, and
its reactions: Figma's own `trigger` and `actions`, with references resolved alongside the raw ids:

- a navigate/swap/overlay/scroll-to/change-to action gains `destination` — `{ status: "resolved",
id, name, type, screen, page }`, plus the destination's overlay settings for swaps and overlays. A
  destination that no longer exists is `{ status: "missing", id }`; one the plugin could not read is
  `{ status: "error", id, error }`. Neither stops the rest of the scan.
- `SET_VARIABLE` gains `variable: { id, name, resolvedType }`, and `SET_VARIABLE_MODE` gains
  `collectionName` and `modeName` — `null` when they cannot be read; the ids stay.
- `CONDITIONAL` keeps its blocks; a `null` condition is the else branch.
- A reaction stored in Figma's older single-`action` form is returned as `actions: [action]`.

The result also has `schemaVersion: 1`, `fileKey` (`null` for an unsaved session file), `fileName`,
the containing `page` and its `flowStartingPoints`.

**Limits.** `maxNodes` defaults to 5,000 (maximum 50,000). `nodesScanned` says how many were read and
`truncated: true` means the limit was hit with nodes still unread — exactly reaching it is not
truncation. `includeEmpty: true` also lists nodes that could hold reactions but have none.

## `trace_prototype_flow`

`{ nodeId, maxScreens?, maxNodesPerScreen?, fileKey? }`. Starts from the screen containing `nodeId`
(a screen is a direct child of a page or section) and follows screen navigations — navigate, swap,
overlay — breadth-first. A page or a section is not a valid start; pass one of its screens.

- `screens` lists each screen reached, in order, with its `depth` and `reachedVia` (the node whose
  interaction reached it).
- `edges` lists every interaction found on an expanded screen: its source node, trigger,
  `actionPath` (e.g. `reactions[0].actions[1].conditionalBlocks[0].actions[0]`), the enclosing
  `conditions` outermost first, the action, and its `kind`: `screen`, `in-screen`, `back`, `close`,
  `url`, `variable`, `media` or `unsupported`. Only `screen` edges are followed; the rest are listed.
- A screen edge has `toScreen`, and `revisit: true` when that screen was already reached, so cycles
  end. A destination that cannot be resolved gets `toScreen: null` and an entry in `unresolved`.
- Every branch of a conditional is followed, because conditions are not evaluated: a trace shows
  what is reachable, not what a given state would do.
- Destinations on other pages are loaded and expanded like any other screen.

**Limits.** `maxScreens` defaults to 25 (maximum 500); screens found beyond it are listed in
`pending` with `truncated: true`. `maxNodesPerScreen` (default 5,000, maximum 50,000) bounds each
screen's scan and also sets `truncated` when hit.
