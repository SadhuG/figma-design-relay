# `run_script`

`run_script` executes JavaScript against the [Figma Plugin API](https://developers.figma.com/docs/plugins/api/api-reference/)
inside whichever file has the bridge plugin open. It is the bridge's escape
hatch: the other tools cover common operations with validated inputs, and
`run_script` covers everything else — components and variants, instances and
overrides, variables and modes, styles, boolean operations, vector editing,
prototyping reactions, per-segment text styling, and any read the serializer
does not expose.

Prefer a dedicated tool when one exists. Reach for `run_script` when none does.

## Contract

Your source is wrapped in an async function and called, so you get top-level
`await` and top-level `return`:

```js
const page = figma.currentPage;
const frames = page.findAll((n) => n.type === "FRAME");
return { count: frames.length, ids: frames.map((f) => f.id) };
```

`return` is the only output channel — `console.log` is discarded.

**Always return the ids of nodes you create or mutate.** Returned Figma nodes
collapse to `{ id, name, type }`, so a whole node object tells you almost
nothing; ids let the next call address the same nodes.

## Result shape

| Field                                         | Meaning                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `{ ok: true, value }`                         | Success. `value` is your return value, sanitised.                          |
| `{ ok: true, truncated: true, valuePreview }` | The serialised value exceeded 200000 characters; you get the first 200000. |
| MCP error result                              | The script threw. The text is `ErrorName: message`.                        |

Sanitisation rules: Figma nodes → `{ id, name, type }`; `figma.mixed` and any
other symbol → `"mixed"`; circular references → `"[circular]"`; functions →
`"[function]"`; nesting deeper than 12 → `"[max depth]"`; arrays longer than
500 items are cut with a `"[+N more]"` marker.

## Limits

- Source: 100000 characters.
- Result: 200000 characters, depth 12, 500 array items per array.
- The bridge times out a request after 3 minutes.
- Design editor only. Dev Mode is read-only and rejects `run_script` up front.

## Gotchas

- **Colors are 0-1**, not 0-255. `{ r: 1, g: 0, b: 0 }` is red.
- **`fills` and `strokes` are read-only arrays.** Clone, modify, reassign:
  ```js
  const fills = JSON.parse(JSON.stringify(node.fills));
  fills[0].color = { r: 0.2, g: 0.4, b: 1 };
  node.fills = fills;
  ```
- **Load fonts before touching text.** Any write to a text node — including
  `appendChild` and `setBoundVariable` — throws
  `Cannot write to node with unloaded font "<family> <style>"` unless the node's
  _current_ fonts are loaded first:
  ```js
  const segments = node.getStyledTextSegments(["fontName"]);
  await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)));
  node.characters = "Hello";
  return { mutatedNodeIds: [node.id] };
  ```
- **Switch pages with `await figma.setCurrentPageAsync(page)`.** The synchronous
  `figma.currentPage = page` setter throws. Page context resets to the first
  page at the start of every call.
- **`await` every promise.** An unawaited `loadFontAsync` or
  `setCurrentPageAsync` fails silently and leaves half-applied changes.
- **Position new top-level nodes away from (0, 0).** Nodes appended straight to
  the page default there and stack on top of each other.
- **Work incrementally.** Several small scripts you validate between are far
  more reliable than one large one.

## Scripts are not atomic

Unlike Figma's own `use_figma`, a failed `run_script` does **not** roll back.
The Plugin API has no transaction or rollback primitive, so a script that
creates three nodes and then throws leaves those three nodes in the file. On an
error: read the message, run a read-only script to inspect the current state,
clean up what was half-created, and only then retry. Do not blindly re-run — that
is how you end up with duplicates.
