# Code Connect

Code Connect ties a Figma component to the component in your codebase that
implements it, so an agent writing code from a design uses _your_ `<Button>`
instead of generating a new div.

On Figma Design Relay, Code Connect is **entirely local**. Mappings are the
`*.figma.tsx` files in your repository — the same files Figma's own
`@figma/code-connect` CLI reads — and the relay reads and writes them directly.
Nothing is fetched from or published to Figma's cloud.

## Where mappings live

A mapping is a `figma.connect(...)` call in a Code Connect file:

```tsx
import figma from "@figma/code-connect";
import { Button } from "./Button";

figma.connect(Button, "https://www.figma.com/design/AbC123/Design-System?node-id=1-2", {
  props: {
    label: figma.string("Label"),
  },
  example: (props) => <Button {...props} />,
});
```

The URL names the Figma file key and the node — a `COMPONENT` or
`COMPONENT_SET`. For a component with variants, map the **set**: that is what
an instance of any of its variants is matched through.

These are ordinary source files. Commit them; review them like code.

## The four tools

| Tool                           | Needs the plugin | What it does                                                                                                                                                    |
| ------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_code_connect_map`         | no               | Returns the mappings — all of them, those for one `fileKey`, or those for a list of `nodeIds` (with the ids that have none under `unmapped`).                   |
| `get_context_for_code_connect` | yes              | A component's property definitions, the options on each variant axis, its key and description — what you need to write an accurate `props` block.               |
| `get_code_connect_suggestions` | yes              | Proposes workspace components for Figma components by name, each with a score and the evidence for it. Already-mapped components are reported, not re-proposed. |
| `add_code_connect_map`         | yes              | Writes a mapping file, or appends to an existing one. Never publishes anything.                                                                                 |

`get_design_context` also consults the mappings — see
[Design context](#design-context) below.

### `get_code_connect_map`

```json
{
  "mappings": [
    {
      "component": "Button",
      "fileKey": "AbC123",
      "nodeId": "1:2",
      "source": "src/ui/Button.figma.tsx",
      "importPath": "src/ui/Button",
      "props": ["label"]
    }
  ],
  "unmapped": [],
  "filesScanned": 1,
  "errors": []
}
```

`importPath` is where the component comes from: a relative import is resolved
to a workspace-relative path, a package import is kept as written. It is absent
when the file does not import the component. `props` lists the keys of the
`props` object, in source order.

Node ids like `1:2` recur in every Figma file, so a lookup by node id only
matches mappings for the file the node is in. That file is the `fileKey` you
pass, or — when you omit it — the one connected file. If several files are
connected and you pass no `fileKey`, only node ids that are unique across all
mappings match.

### `get_context_for_code_connect`

Pass a `COMPONENT` or `COMPONENT_SET`. A variant is described through its set,
with the variant you passed under `selectedVariant`. An instance is refused,
and the error names its main component so you can retry with that.

### `get_code_connect_suggestions`

Matching is by name only. Names are compared case- and separator-insensitively,
with a Figma path such as `Button/Primary` compared by its first segment. An
exact match scores 1 with the evidence `exact name match`; a name that is a
prefix of the other scores between 0.5 and 0.9. Anything else is not proposed
at all — no suggestion is better than a bad one. Candidates come from
capitalised `export const`, `export function` and `export class` declarations
in `.ts`, `.tsx`, `.js` and `.jsx` files, excluding Code Connect files and
tests.

Accept a suggestion by calling `add_code_connect_map`.

### `add_code_connect_map`

Writes to `file`, a path relative to the MCP server working directory that
must end in `.figma.tsx` or `.figma.jsx` (the generated `example` is JSX).

- A new file gets the `@figma/code-connect` import, the component import and
  one `figma.connect` call.
- An existing file gets the call appended, plus an import for the component
  when the file does not already import it.
- Each prop you list is stubbed as `figma.string("<name>")`. Refine it: use
  `get_context_for_code_connect` to see whether it is really a boolean, an enum
  or an instance swap.
- The URL is built from the file key and the node the plugin confirms — the set,
  when you pass a variant. The plugin must be open in the file, and the file
  must have been saved (an unsaved file has no key).

It refuses, writing nothing, when:

- the node is already mapped anywhere in the workspace — edit that mapping;
- `file` resolves outside the working directory, including through a link;
- `file` already holds a `figma.connect` call the parser cannot read, because a
  duplicate there would go unnoticed.

## Why there is no `send_code_connect_mappings`

Figma's own server can publish mappings to Figma's cloud. The relay
deliberately cannot. Its equivalent of publishing is `git commit`: the mapping
is a reviewable diff in the repository it describes, versioned with the
component it points at, and it needs no Figma API access or paid plan.

## Discovery

The relay looks for `**/*.figma.{ts,tsx,js,jsx}` under the MCP server's working
directory on every call — there is no cache, so a mapping written a second ago
is already visible.

- These directories are never entered: `node_modules`, `.git`, `dist`, `build`,
  `out`, `.next`, `.turbo`, `coverage`.
- A file or link that resolves outside the working directory is skipped.
- The walk stops with an error after 10,000 directories. Some MCP clients
  start servers in `/` or a system directory; the error says to start it from
  the project root instead.

## What the parser reads

The parser is a small scanner rather than a TypeScript compiler, so the server
takes on no new dependency. It reads:

- `figma.connect(Component, "url")` and `figma.connect(Component, "url", { … })`,
  including a dotted component such as `Icons.Search`;
- the URL as a string or template literal without interpolation;
- the keys of the `props` object.

It skips calls inside comments. Anything else is **reported, never dropped** —
each `errors` entry names the file and line:

- a URL held in a variable, or not a Figma node URL;
- an unterminated call. Scanning of that file stops there, and the error says
  so. The usual cause is an apostrophe in JSX text inside `example`
  (`<p>Don't</p>`), which the scanner reads as an opening quote; write it as
  `&apos;`.

When a mapping file has errors, `get_design_context` says so in its caveats.
A component in that file may be mapped even though the response does not show
it.

## Design context

`get_design_context` matches every node in the described subtree against the
mappings: an instance through its main component's set, then its main
component; a component or set by its own id. When anything matches:

- a `## Code Connect mappings` section comes before the reference code, listing
  each mapped node, its component, where to import it from and the mapping
  file;
- in `react` output, the mapped instance renders as the component itself —
  `{/* Code Connect: Button — src/ui/Button.figma.tsx */}` then
  `<Button data-figma-node="…">` — rather than the `map with Code Connect`
  placeholder.

This is the top of the hint priority in
[design-context.md](design-context.md#hint-priority).

## Limits

- **Library components.** An instance of a component from a team library
  points at that component's id in _this_ file, not in the library file where
  the mapping's URL points. The Plugin API cannot translate between the two, so
  such instances are not matched. Mapping the library component from inside
  the library file works.
- **Name-only suggestions.** Suggestions do not compare props or structure.
- **One mapping per node.** `add_code_connect_map` refuses a second mapping for
  the same node; variant-specific mappings (`variant: { … }`) have to be
  written by hand.
