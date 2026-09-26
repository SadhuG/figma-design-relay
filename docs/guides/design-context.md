# `get_design_context`

`get_design_context` is the tool an agent reaches for first when implementing a
design. One call returns everything needed to write the code for a node:
reference code in the format you asked for, the design tokens the node uses,
the icons and images in it exported as files, and a screenshot the client
renders inline. Prefer it over `get_document` plus `get_screenshot`.

The response is **reference**, not final code. The agent adapts it to the
target project's stack, component library and token system.

## Parameters

| Parameter  | Type                                         | Default                      | Meaning                                                                                                                                |
| ---------- | -------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `nodeId`   | string (`123:456`)                           | selection, then current page | The node to describe. When omitted, the current selection is used; with nothing selected, the current page. An unknown id is an error. |
| `depth`    | number                                       | `2`                          | How many levels of children to serialize. Deeper levels are collapsed to a `childCount`.                                               |
| `format`   | `"react"` \| `"html"` \| `"css"` \| `"json"` | `"react"`                    | Reference code format. `json` returns the serialized tree itself (see [serialized-nodes.md](../reference/serialized-nodes.md)).        |
| `assetDir` | string                                       | _none_ — no export           | Directory, relative to the MCP server's working directory, to export icons and images into. Must resolve inside that directory.        |
| `fileKey`  | string                                       | the only connected file      | Which file to read when several have the plugin open. Use `list_files` to discover keys.                                               |

Only the first node of a multi-node selection is described, and the response
opens by saying so and how many were selected. Pass `nodeId` to be explicit.

## Response shape

The result is a multi-part MCP result, always in this order:

1. **A text block** — reference code, tokens, and exported assets (below).
2. **An image block** — a 2× PNG screenshot of the node, clipped to its bounds,
   delivered as a real `image` content block so MCP clients render it rather
   than showing base64. It is omitted when the root is a page (pages cannot be
   exported) or when the export fails; in the latter case the text block opens
   with `Screenshot unavailable: …` and the reason.

### Sections of the text block

The text block is Markdown with up to five `##` sections, in this order,
preceded by any caveats (partial selection, missing screenshot, unreadable Code
Connect files) as plain lines. Sections with nothing to say are omitted.

**`## Code Connect mappings`** — one row per node in the subtree that a
Code Connect file in the workspace maps: the node, the component, where to
import it from, and the mapping file. It comes before the code because it
changes what the agent should write. See [code-connect.md](code-connect.md).

**`## Reference code (<format>)`** — the generated code in a fenced block.

- A mapped instance (`react` only) renders as its component, preceded by
  `{/* Code Connect: Button — src/ui/Button.figma.tsx */}`, with its children
  inside it.
- Other instances are emitted as a placeholder `<div data-figma-node="…">` preceded
  by a comment naming the main component — the component set's name with the
  variant as detail (`{/* Figma component: Button (Size=lg, Type=Secondary) —
map with Code Connect */}`) — with the instance's own children, the label
  and the nested icon, rendered inside it.
  The generator never invents a codebase component for an instance it has not
  been mapped to, but it does not hide what the instance contains.
- Text nodes name their text style in a comment when one is applied. Text
  content is entity-escaped (`&lt;`, `&amp;`, `&#123;`) so copy containing
  braces or angle brackets still yields code that parses as JSX and as HTML.
- Auto-layout, padding, corner radius and fill/fill-sizing map to Tailwind
  classes in `react` and `html`, and to declarations in `css`. Lengths are
  rounded to two decimals; Figma's `13.333333969116211` is noise, not intent.
- A node that was exported as an asset renders as
  `<img src="assets/…svg" alt="…" data-figma-node="…" />` in place of its
  paths, so the code references the file rather than redrawing the icon.

**`## Design tokens`** — one row per distinct variable or style used anywhere
in the subtree, with the property it binds, and how many nodes use it. The
agent maps these onto the project's own token system. A variable and a style
that share a name are listed separately.

**`## Unresolved references`** — bindings whose name could not be fetched
(usually a library that is unreachable or not enabled for this file), listed by
id. The code falls back to the raw value for these, so they are kept out of the
token list: there, a raw value means nothing was bound; here, it means the
binding's name is unknown.

**`## Exported assets`** — one row per file written under `assetDir`, with the
Figma node it came from. Present only when `assetDir` was given and the
subtree contained something exportable.

## Hint priority

Each property in the generated code comes from the most specific source
available, in this order:

1. **Code Connect mapping** — a mapped instance renders as the real codebase
   component, and the comment above it says `Code Connect` rather than
   `Figma component … map with Code Connect`, so a mapped component never reads
   like a guessed one. See [code-connect.md](code-connect.md).
2. **Component description** — an instance's main component name, then the
   designer's description of that component (the variant's own, else its
   set's), as a `component description:` comment. It appears under a Code
   Connect line too: the mapping names the code, the description says how it
   is meant to be used.
3. **Annotation** — each Dev Mode annotation on the node, as an
   `annotation: <note> [<pinned properties>]` comment, on any node type.
4. **Design token** — a bound variable, emitted as `var(--token-name)`; a named
   text style is surfaced as a `text style:` comment at this rank.
5. **Raw value** — the resolved hex or pixel value, only when nothing above
   applies.

Every hint comment names its source, so a mapped component, a documented one
and a guessed one read differently. Designer text is collapsed to one line, and
`*/` and `-->` are broken up so a note can never close its own comment. HTML
output carries the same hints as `<!-- … -->` comments; CSS carries none.

The rule that matters most is **token over value**: a fill bound to
`color/surface` is emitted as `var(--color-surface)` and the hex it resolves to
appears nowhere in the code. A raw value in the output therefore means the
designer bound nothing — it is a signal, not a rounding error.

Token names are converted to CSS custom property names by lowercasing and
replacing `/`, `_` and whitespace with `-`: `Color/Brand Primary` becomes
`--color-brand-primary`.

## Assets

Three kinds of node are exported, every one as SVG: vectors (`VECTOR`,
`BOOLEAN_OPERATION`, `STAR`, `POLYGON`, `LINE`), childless nodes with an image
fill (the SVG embeds the raster), and a container — group, frame, instance or
component — whose descendants are all vectors, plain rectangles and ellipses,
or nested groups of the same, with at least one real vector among them. That
last case is what keeps an icon whole: an icon in a design system is an
instance of an icon component, and the walk stops at that instance rather than
shattering it into a file per path. A container of nothing but rectangles is a
layout, not an icon, and is walked into — as is a frame with a background
image, whose headline would otherwise be baked into the export. A container's
background image is therefore not exported; use `save_screenshots` for it.

Only the serialized tree is walked, so an icon deeper than `depth` is not
exported — and cannot be recognised, since a container cut at the limit has no
children to inspect. When `assetDir` was given and the tree contains such
containers, the response opens by saying how many were collapsed.

Files are named `<layer-name>-<node-id>.svg` (`icon/search` on `12:34` becomes
`icon-search-12-34.svg`; the id's `:` becomes `-` and an instance path's `;`
becomes `_`, so distinct ids never share a file), land under `assetDir`, and the response lists them by
workspace-relative path. The text tells the agent to **reference those files and not hand-write
`<svg>` markup**: the generated code has no vector data, and a same-named icon
from the project is only a match when the glyph clearly is.

This is a deliberate divergence from Figma's own MCP server, which returns asset
URLs that expire after about a week. A file in the repository is what the code
you keep actually needs, and it can be committed.

`assetDir` is resolved against the MCP server's working directory and checked
with `realpath`; anything that escapes it — `../elsewhere`, an absolute path
outside, a symlink out — is refused with an error naming the working directory,
and nothing is written.

## Limits

- **Depth.** `depth` bounds the tree; the default of 2 suits a card or list
  item. Raise it for a whole screen, and expect proportionally larger output.
- **Characters.** The text block is capped at **200,000 characters**. Beyond
  that it is cut and ends with
  `[truncated at 200000 characters — request a smaller node or a lower depth]`,
  so a large frame degrades instead of failing. The image block is unaffected.
- **Time.** The relay gives each plugin request 180 seconds. One call to this
  tool makes up to three: the serialization, the asset export (when `assetDir`
  is set), and the screenshot. A very large subtree with many assets can run
  long; narrow the node or drop `assetDir` if it does.
- **Formats.** An unsupported `format` is rejected up front by the input schema.
