# Slides support

The plugin runs in Figma Slides decks as well as design files and FigJam boards. In Slides the
relay can **read everything and edit what is already there**; it deliberately cannot build slide
structure. This page says exactly where that line sits, because an unstated scope boundary reads as a
bug.

## Checking which editor you are in

`get_metadata` returns `editorType`, and `list_files` reports it for every connected file. A Slides
deck reports `"slides"`. Run the plugin inside the deck, just as in a design file.

## What works

- **Every read tool**: `get_document`, `get_node`, `get_selection`, `get_metadata`,
  `get_design_context`, `get_variable_defs`, `get_styles`. A deck's page serializes as the slide grid,
  its rows and their slides (`SLIDE_GRID` → `SLIDE_ROW` → `SLIDE`), with each slide's content beneath
  it like any other frame.
- **Screenshots**: `get_screenshot` and `save_screenshots`, including of a single slide by its id.
- **Edits to nodes inside existing slides**: `set_text_content`, `set_node_properties`,
  `set_solid_fill`, `set_node_visibility`, `create_text` into a slide via `parentId`,
  `duplicate_nodes`, `reparent_nodes`, `group_nodes`, `ungroup_node` and `delete_nodes`.
- **`run_script`**, which reaches the whole Slides Plugin API — including the slide-creation calls
  the dedicated tools do not wrap. It is the escape hatch here as everywhere else.

## What does not, and why

**Creating slide structure is out of scope.** There is no tool for adding a slide, a slide row or a
slide grid, and `create_frame`, `create_shape`, `create_page`, `set_auto_layout`, `create_section` and
the other design-only writes are refused in Slides with a message naming the editor they need. The
node types exist, but the layout rules a deck imposes on them — slide size, row order, grid position
— are not something this relay models yet, and a half-working slide builder is worse than none: it
would produce decks that look right in the tool result and wrong on screen.

The FigJam tools (`create_sticky`, `create_shape_with_text`, `create_connector`, `generate_diagram`)
are refused too; they need a FigJam board.

`duplicate_nodes` and `delete_nodes` accept a slide's own id like any other node's. Where Figma puts a
duplicated slide in the grid is Figma's decision, not the relay's; check the result with
`get_document` before relying on the order.

## If a tool is refused

The refusal names the editor the tool needs and tells you to run the plugin in that kind of file and
retry with its `fileKey`. Nothing was changed: the check runs before the tool touches the document.
