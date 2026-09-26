# Libraries and identity

Four tools let an agent see past the file the plugin is open in: who is signed in, which published
libraries the file can use, and how to bring a published asset into the file. They are deliberately
**narrower than Figma's own MCP server**, because the Plugin API exposes much less than Figma's REST
and internal APIs do. This page says exactly what each tool can and cannot reach.

| Tool                   | What it does                                                                         | Writes? |
| ---------------------- | ------------------------------------------------------------------------------------ | ------- |
| `whoami`               | The signed-in user as `{ id, name, photoUrl }`, or `user: null` with a note          | no      |
| `get_libraries`        | Enabled libraries by their published variable collections; one collection's keys     | no      |
| `import_library_asset` | Import a published component, component set, style or variable by key                | yes     |
| `search_design_system` | Search components and instances in every open design file, plus variable collections | no      |

## Permissions

`plugin/manifest.json` requests two permissions, and Figma lists them when you import the plugin:

- **`currentuser`** unlocks `figma.currentUser`, which `whoami` reads.
- **`teamlibrary`** unlocks `figma.teamLibrary`, which `get_libraries` and `search_design_system`
  read. Without it, reading `figma.teamLibrary` throws.

Team library APIs are also **gated by Figma plan**. When Figma refuses a call, for a missing
permission or for the plan, the tool returns an error that names the permission or the plan and says
what to do next, never Figma's raw message:

> Figma refused the teamLibrary call because the plugin does not have the "teamlibrary" permission.
> Add it to the "permissions" array in plugin/manifest.json, rebuild the plugin, and relaunch it from
> Figma's Development menu.

Every other relay tool keeps working either way. `search_design_system` does not fail at all; it
falls back to local components and reports why under `libraryError`, once however many files were
searched.

## `whoami`

Returns `{ user: { id, name, photoUrl } }`. `figma.currentUser` can be `null` even with the
permission granted, so the tool then returns `{ user: null, note }` rather than an empty object. It is
a read, so it works in every editor the plugin runs in.

## `get_libraries`

The Plugin API has no call that lists a library's components. What it does expose is each enabled
library's **published variable collections**, so that is what this tool returns, grouped by library:

```json
{
  "libraries": [
    {
      "name": "Core",
      "collections": [
        { "key": "c1…", "name": "Colors" },
        { "key": "c2…", "name": "Spacing" }
      ]
    }
  ],
  "note": "…"
}
```

A library that publishes components but no variables **does not appear** here. An empty list means
no enabled library publishes variables, not that no library is enabled.

Pass a collection's key back as `collectionKey` to list its variables, each with the key
`import_library_asset` takes:

```json
{
  "collectionKey": "c1…",
  "variables": [{ "key": "v1…", "name": "color/bg", "resolvedType": "COLOR" }]
}
```

## `import_library_asset`

Takes a `kind` and a published `key` and returns the imported object's id, which the next call uses
to place an instance or bind a variable:

```json
{ "kind": "component", "id": "123:456", "name": "Button", "type": "COMPONENT" }
```

`type` is absent for a variable, which has none.

| `kind`         | Figma call                                 | Where the key comes from                                                          |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `component`    | `figma.importComponentByKeyAsync`          | `key` on a serialized COMPONENT, `mainComponent.key` on an instance, a search hit |
| `componentSet` | `figma.importComponentSetByKeyAsync`       | `key` on a serialized COMPONENT_SET, or a `componentSet` search hit               |
| `style`        | `figma.importStyleByKeyAsync`              | `style.key`, read in the library file with `run_script`                           |
| `variable`     | `figma.variables.importVariableByKeyAsync` | `get_libraries` with a `collectionKey`                                            |

The key must belong to an asset **published** in a library that is **enabled for this file**. A
component that only exists locally is not importable, and does not need to be: use its node id.
When Figma cannot resolve a key, the error says this rather than stopping at "Failed to import".
So does a refusal to access the library, which is a sharing problem: only a message naming the
manifest or the permission, as Figma's own refusal does, is reported as a missing manifest
permission.

Importing writes into the document and needs the design-file API, so the tool works in design files
only; FigJam and Slides refuse it up front. To place a component once
it is imported, use `run_script`:

```js
const component = await figma.getNodeByIdAsync("<returned id>");
const instance = component.createInstance();
figma.currentPage.appendChild(instance);
return { createdNodeIds: [instance.id] };
```

## `search_design_system`: what it really searches

**An empty result is not proof that a component does not exist.** The Figma Plugin API cannot
full-text search an organisation's published component libraries. If a search comes back empty and
the component should exist, retry with `allPages: true`, then ask the user to open the library file
with the plugin and search there.

The tool searches only what the plugin can enumerate:

1. **Components and component sets on the searched pages.** A variant is represented by its set,
   because a variant's own name is its property string (`Size=Large`), not what anyone searches for.
2. **The main components of instances on the searched pages.** This is the only way a _library_
   component is found: when an instance of it has been placed. Such hits carry `remote: true`.
3. **Published variable collections** of enabled libraries, when the permission and plan allow it.

By default only the **current page** is searched. The plugin runs with dynamic page loading, so
other pages are not in memory; `allPages: true` calls `figma.loadAllPagesAsync()` and then searches
the whole document. That is slow on a large file — and the load counts against the bridge's
three-minute request timeout — so it is opt-in, and the note on a current-page result suggests it.
`searched` then reads `components and component instances on every page`.

Every hit carries its `kind`, its `key`, and a `score`:

| Score | Match                                    | Example for `button`     |
| ----- | ---------------------------------------- | ------------------------ |
| 1     | the whole name, or one `/` segment of it | `Button`, `Forms/Button` |
| 0.9   | a whole word                             | `Icon Button`            |
| 0.8   | a prefix of the name                     | `Buttons`                |
| 0.7   | a prefix of a word                       | `Icon Buttons`           |
| 0.5   | any other substring                      | `Iconbutton`             |

Matching ignores case, whitespace and ASCII punctuation, so `button primary` and `button/primary`
both match `Button/Primary` exactly. Every other character is kept, so a query in any script works
(`ボタン`, `Botón`).

**Only a `remote: true` hit's key is known to be importable.** A local component's key imports
only if that component has been published, and the Plugin API cannot tell whether it has. In the
file that holds it, use its node id instead.

Hits are ranked and capped at `limit` (default 50, at most 200). When some were cut, `total` says
how many matched and the note says so.

### Every open file at once

With several files open, one search covers **every open design file**. FigJam boards and Slides
decks are skipped — they hold no design-system components — and the response lists them under
`files.skipped`. To search fewer files, pass `files`: a list of file names as `list_files` shows
them (case and surrounding spaces are ignored) or fileKeys, at most 20. When many files are open, an
agent should read their names first and pass only the relevant ones — "the design system file" —
rather than paying for every file. `fileKey` still means exactly one file, and cannot be combined
with `files`.

Every file is asked at the same time, with the same `query`, `limit` and `allPages`, so a search
takes about as long as the slowest file. The answers are merged:

- **One entry per component.** Hits are matched across files by their `key` (and `kind`); a hit
  without a key is never merged.
- **The original wins.** When one of the open files is where the component was built, the entry
  points there — `fileKey`, `fileName` and `id` are that file's — because that is where its
  variants and properties live. With no original open, the entry is the first file's library copy
  (`remote: true`).
- **`alsoIn` lists every other file** it appears in, with that file's node id: a
  where-is-this-used inventory. A library variable collection appears once, with the other files
  under `alsoIn`.
- Entries are ranked by `score`, then originals before library copies, then name, and capped at
  `limit`; `total` is the merged count when some were cut.

A file that fails — its plugin was closed, hot-reloaded or timed out — does not fail the search. It
is listed under `files.skipped` with the reason and, for a dropped connection or timeout, "run the
plugin in that file again". The search fails only when no file could answer, and then its error
names every file's reason.

The response states its own reach, so an agent never has to guess it:

```json
{
  "results": [
    {
      "id": "18:8013",
      "name": "Button",
      "kind": "componentSet",
      "key": "48ba…",
      "score": 1,
      "fileKey": "unsaved-3f1c…",
      "fileName": "Acme Design System",
      "alsoIn": [{ "fileKey": "unsaved-9a2e…", "fileName": "Checkout Screens", "id": "402:77" }]
    }
  ],
  "searched": [
    "components and component instances on the current page",
    "published variable collections"
  ],
  "files": {
    "searched": [
      { "fileKey": "unsaved-3f1c…", "fileName": "Acme Design System" },
      { "fileKey": "unsaved-9a2e…", "fileName": "Checkout Screens" }
    ],
    "skipped": [
      {
        "fileKey": "unsaved-77d0…",
        "fileName": "Q3 Brainstorm",
        "reason": "Skipped: a FigJam board. Only design files hold components to search."
      }
    ]
  },
  "note": "This search covers only what is listed under `searched`, in the files under `files.searched`. …"
}
```

When team library reach is refused, `searched` drops the collections entry and `libraryError`
carries the reason, while the local results are still returned.

Instances are resolved to their main components 64 at a time rather than all at once. If a whole
batch of 64 fails, the sandbox cannot load main components at all — the usual cause is a plugin
hot-reloaded after a rebuild, where each lookup takes seconds and then throws — so the remaining
instances are skipped and `instanceError` says to relaunch the plugin — or, when several files were
searched, `instanceErrors` names each file it happened in. A single broken instance is
skipped silently.

## What has been verified against real Figma

The project has no Figma account whose plan allows team library APIs, so the library half of these
tools has only been tested against stubbed `figma.teamLibrary` and importer objects in
`plugin/src/main/library.test.ts`. Checked against a live file: `whoami`, `search_design_system`'s
local results, and the refusal path — `get_libraries` naming the missing permission, and search
falling back to local components with `libraryError`. **Never exercised live:** real data from
`get_libraries`, a successful `import_library_asset`, a search hit found through a library
instance, and a search across several open files (0.7.5). If one of those misbehaves on a plan that allows them, that is the untested ground, and a
report of what Figma returned is the quickest way to close it.
