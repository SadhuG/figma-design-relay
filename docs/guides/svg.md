# Importing SVG

`create_svg` turns SVG into editable vector layers inside a frame, through Figma's own SVG importer.
It runs in design files only; FigJam, Slides and Dev Mode refuse it, as they do `create_image`.

```json
{ "source": "icons/logo.svg", "name": "Logo", "parentId": "12:3", "x": 16, "y": 16, "width": 48 }
```

## The source

- **Markup**: anything starting with `<` is taken as SVG text. An optional byte-order mark, XML
  declaration, comments and a DOCTYPE may come before the `<svg>` root; anything else — HTML, or a
  prolog that never closes — is refused.
- **A file path**, relative to the MCP server's working directory. The path must stay inside that
  directory once links are resolved, so `../outside.svg`, an absolute path elsewhere or a link or
  junction pointing out are refused. A folder named `..icons` inside the workspace is fine. The file
  is opened once, checked to still be the same regular file it resolved to, and read only up to the
  size limit, so a file swapped or growing mid-read cannot get past the checks.
- **Not** a URL or data URI. Those are refused rather than fetched; save the file into the workspace.

The SVG may be at most **2,097,152 UTF-8 bytes** (2 MiB) — checked on the server and again on the
leader for calls arriving from another relay instance. Only the markup crosses to the plugin, never
the path.

This is a preflight for clear errors, not a sanitizer: Figma parses the SVG, and whatever its
importer cannot handle fails there.

## Placement

`parentId` is resolved first, so a bad parent creates nothing. `x` and `y` are applied after the SVG
joins its parent, so they are relative to it. `width` or `height` alone keeps the other dimension;
both resize to exactly that. If resizing, appending or positioning fails, the new node is removed.

The result is `{ nodeId, nodeName, nodeType, parentId, x, y, width, height, childCount }`.
