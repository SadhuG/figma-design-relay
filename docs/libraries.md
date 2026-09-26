# Libraries and identity

Four tools let an agent see past the file the plugin is open in: who is signed in, which published
libraries the file can use, and how to bring a published asset into the file. They are deliberately
**narrower than Figma's own MCP server**, because the Plugin API exposes much less than Figma's REST
and internal APIs do. This page says exactly what each tool can and cannot reach.

| Tool                   | What it does                                                                     | Writes? |
| ---------------------- | -------------------------------------------------------------------------------- | ------- |
| `whoami`               | The signed-in user as `{ id, name, photoUrl }`, or `user: null` with a note      | no      |
| `get_libraries`        | Enabled libraries by their published variable collections; one collection's keys | no      |
| `import_library_asset` | Import a published component, component set, style or variable by key            | yes     |
| `search_design_system` | Search components and instances on the current page, plus variable collections   | no      |

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
falls back to the current page and reports why under `libraryError`.

## `whoami`

Returns `{ user: { id, name, photoUrl } }`. `figma.currentUser` can be `null` even with the
permission granted, so the tool then returns `{ user: null, note }` rather than an empty object. It is
a read, so it works in Dev Mode.

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

Importing writes into the document, so the tool is rejected in Dev Mode. To place a component once
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
the component should exist, ask the user to open the library file with the plugin and search there.

The tool searches only what the plugin can enumerate:

1. **Components and component sets on the current page.** A variant is represented by its set,
   because a variant's own name is its property string (`Size=Large`), not what anyone searches for.
2. **The main components of instances on the current page.** This is the only way a _library_
   component is found: when an instance of it has been placed. Such hits carry `remote: true`.
3. **Published variable collections** of enabled libraries, when the permission and plan allow it.

Other pages are not searched. Every hit carries its `kind`, its `key` for `import_library_asset`,
and a `score` (1 for an exact name segment, 0.8 for a prefix, 0.5 for a substring). Matching ignores
case and separators, so `button primary` matches `Button/Primary`.

The response states its own reach, so an agent never has to guess it:

```json
{
  "results": [
    { "id": "18:8013", "name": "Button", "kind": "componentSet", "key": "48ba…", "score": 1 }
  ],
  "searched": [
    "components and component instances on the current page",
    "published variable collections"
  ],
  "note": "This search covers only what is listed under `searched`. …"
}
```

When team library reach is refused, `searched` drops the collections entry and `libraryError`
carries the reason, while the local results are still returned.
