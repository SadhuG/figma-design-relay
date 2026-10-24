# Figma Design Relay

[![Pairing with Hopp](https://gethopp.app/git/hopp-shield.svg?ref=hopp-repo)](https://gethopp.app)

- [Demo](#demo)
- [Quick Start](#quick-start)
  - [Updating](#updating)
  - [Troubleshooting](#troubleshooting)
- [Available Tools](#available-tools)
- [Local development](#local-development)
- [Structure](#structure)
- [How it works](#how-it-works)

<br/>

<img src="https://raw.githubusercontent.com/SadhuG/figma-design-relay/main/logo.png" alt="Figma Design Relay" align="center" />

<br/>

> [!NOTE]  
> Requires the Figma desktop app (macOS/Windows). The browser version of Figma does not support importing development plugins.

While other amazing Figma MCP servers like [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP/) exist, one issues is the [API limiting](https://github.com/GLips/Figma-Context-MCP/issues/258) for free users.

The limit for free accounts is 6 requests per month, yes **per month**.

Figma Design Relay is a solution to this problem. It is a plugin + MCP server that streams live Figma document data to AI tools without hitting Figma API rate limits, so its Figma MCP for the rest of us ✊

It supports **multiple Figma files connected simultaneously**; open the plugin in each file and your AI agent can query any of them by `fileKey`. Single-file setups work exactly as before with no changes required.

It also includes a small, opt-in set of **write tools** for safe agent-driven edits — see [Editing Notes](#editing-notes) below.

## Demo

[Watch a demo of building a UI in Cursor with Figma Design Relay](https://youtu.be/ouygIhFBx0g)

[![Watch the video](https://img.youtube.com/vi/ouygIhFBx0g/maxresdefault.jpg)](https://youtu.be/ouygIhFBx0g)

## Quick Start

### 1. Check the requirements

- **Node.js 20 or newer.** Run `node --version` to check; get it from [nodejs.org](https://nodejs.org) if it is missing or older.
- **The Figma desktop app** (macOS or Windows). Importing a plugin from a manifest only works there, not in the browser.
- **An AI tool that speaks MCP**, such as Claude Code, Claude Desktop, Cursor, Windsurf or Codex.

### 2. Download

Download **[figma-design-relay.zip](https://github.com/SadhuG/figma-design-relay/releases/latest/download/figma-design-relay.zip)** (always the latest version; older ones are on the [releases page](https://github.com/SadhuG/figma-design-relay/releases)) and unzip it somewhere you will keep it, for example `~/figma-design-relay` or `C:\Users\<you>\figma-design-relay`. You get one `figma-design-relay` folder:

```
figma-design-relay/
  server/     the MCP server, ready to run: its dependencies are included
  plugin/     the Figma plugin; you import plugin/manifest.json
  VERSION     the version you have
  CHANGELOG.md, README.md, LICENSE.md
```

This fork is distributed only through GitHub Releases — there is no npm package or `npx` command.

<details>
<summary>Optional: check the download</summary>

Download `SHA256SUMS.txt` from the same release into the folder holding the zip, then run:

```bash
shasum -a 256 -c SHA256SUMS.txt          # macOS / Linux
```

```powershell
Get-FileHash figma-design-relay.zip      # Windows: compare with the hash in SHA256SUMS.txt
```

</details>

### 3. Connect your AI tool

The server is one command: `node <folder>/server/dist/index.js`, with the absolute path to the folder you unzipped. Add it to your AI tool as `figma-design-relay`:

**Claude Code**

```bash
claude mcp add --scope user figma-design-relay -- node /absolute/path/to/figma-design-relay/server/dist/index.js
```

**Claude Desktop, Cursor, Windsurf** — add this to the tool's MCP config file (Claude Desktop: _Settings → Developer → Edit Config_; Cursor: `~/.cursor/mcp.json`; Windsurf: `~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "figma-design-relay": {
      "command": "node",
      "args": ["/absolute/path/to/figma-design-relay/server/dist/index.js"]
    }
  }
}
```

**Codex** — add this to `~/.codex/config.toml`:

```toml
[mcp_servers.figma-design-relay]
command = "node"
args = ["/absolute/path/to/figma-design-relay/server/dist/index.js"]
```

> [!TIP]
> On Windows, write the path with forward slashes (`C:/Users/you/figma-design-relay/server/dist/index.js`) or doubled backslashes (`C:\\Users\\you\\…`). A single backslash breaks JSON and TOML.

Restart the AI tool after changing its config.

### 4. Add the Figma plugin

In the Figma desktop app go to `Plugins > Development > Import plugin from manifest` and select `manifest.json` from the unzipped `plugin/` folder. It appears as **Figma Design Relay**.

The plugin runs in design files, FigJam boards and Slides decks. It does not run in Dev Mode: Figma does not let one plugin support both Dev Mode and FigJam.

The plugin requests two permissions, which Figma shows when you import it:

- `currentuser` — so `whoami` can report who is signed in.
- `teamlibrary` — so `get_libraries`, `import_library_asset` and `search_design_system` can reach published libraries. Team library APIs are gated by Figma plan; on plans without them these tools return an explicit error naming the requirement (`search_design_system` falls back to the open file), and every other tool is unaffected.

### 5. Check it works 🎉

Open a Figma file and run the plugin (`Plugins > Development > Figma Design Relay`). With your AI tool running, the status chip says **Live**. Ask your AI tool to "list the connected Figma files"; it calls `list_files` and names your file.

To work across multiple files, just open the plugin in each Figma file. The relay keeps all connections active and your AI agent can target any of them by `fileKey`.

The panel shows the file, the selection and the relay address it dials (`ws://localhost:1994`), with a status chip underneath: **Live**, **`<Agent>` is working** while an AI tool calls it (named after the app, e.g. "Claude Code is working"), or **Relay lost** with a countdown and a **Retry now** button. The chevron in its top-right corner collapses it to a 36 px bar that keeps the status chip visible; the choice is remembered across sessions.

While your AI tool is running you can also open <http://127.0.0.1:1994/> in a browser. The relay's dashboard shows which Figma files the plugin is open in (and whether each is a design file, FigJam board or Slides deck), every request your AI tool sends to Figma with how long it took and any error, and the other relay processes sharing the connection. It is read-only, and it answers only on this machine.

If you want to know more about how it works, read the [How it works](#how-it-works) section.

### Updating

Every new version is published as a [release](https://github.com/SadhuG/figma-design-relay/releases), with what changed in its notes. To be told when one comes out, use **Watch → Custom → Releases** at the top of the repository page.

To update:

1. Quit your AI tool, so nothing is running the old server.
2. Delete everything inside your `figma-design-relay` folder.
3. Download [figma-design-relay.zip](https://github.com/SadhuG/figma-design-relay/releases/latest/download/figma-design-relay.zip) again and unzip it in the same place.
4. Start your AI tool, and in Figma close and re-run the plugin.

The paths do not change, so your MCP config and the Figma import keep working without edits. Delete the old files first rather than unzipping over them: an update can drop a dependency, and its old files would be left behind. `VERSION` in the folder says which version you have.

### Troubleshooting

| Symptom                                                 | Fix                                                                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node: command not found`, or `node --version` below 20 | Install Node.js 20 or newer, then restart the AI tool.                                                                                                                                                |
| The chip stays on **Relay lost**                        | The AI tool is not running the server. Check that it is running, that its config path ends in `server/dist/index.js` and is absolute, and restart it. Your AI tool's MCP logs show any startup error. |
| `Cannot find module …` in the AI tool's MCP logs        | The folder is incomplete. Delete it and unzip the whole archive again.                                                                                                                                |
| No **Development** entry under Plugins                  | You are in Figma in the browser. Use the desktop app.                                                                                                                                                 |

## Available Tools

| Tool                           | Description                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_files`                   | List all connected Figma files (supports multi-file workflows)                                                                                                                                   |
| `get_document`                 | Get the current Figma page document tree                                                                                                                                                         |
| `get_selection`                | Get the currently selected nodes in Figma                                                                                                                                                        |
| `get_node`                     | Get a specific Figma node by ID (colon format, e.g. `4029:12345`); `includePrototype: true` adds its prototype scan (design files only)                                                          |
| `get_prototype_connections`    | Read-only: every prototype interaction under a node or page, with destinations, variables and modes resolved — design files only ([guide](docs/guides/prototypes.md))                            |
| `trace_prototype_flow`         | Read-only: follow screen-to-screen navigation breadth-first from a screen, with revisits, unresolved and pending screens — design files only                                                     |
| `get_layout_tree`              | Absolute transforms and layout bounds for a scene root; bounded to 2,000 nodes by default (maximum 10,000). Separate screenshots are non-atomic; masks and painted visibility are not evaluated. |
| `get_styles`                   | Get all local paint, text, effect, and grid styles; in FigJam, unavailable categories come back empty with a note                                                                                |
| `get_metadata`                 | Get file name, pages, and current page info                                                                                                                                                      |
| `get_design_context`           | Reference code, design tokens, exported assets and a screenshot for a node — one call ([guide](docs/guides/design-context.md))                                                                   |
| `get_variable_defs`            | Get all variable collections, modes, and values (design tokens); in FigJam, unavailable variables come back empty with a note                                                                    |
| `get_screenshot`               | Export nodes as PNG/SVG/JPG/PDF (base64-encoded)                                                                                                                                                 |
| `save_screenshots`             | Export and save screenshots directly to the local filesystem                                                                                                                                     |
| `get_motion_styles`            | List all available animation presets (beta)                                                                                                                                                      |
| `get_node_motion`              | Read a node's current animation styles and properties (beta)                                                                                                                                     |
| `apply_animation_style`        | Apply a preset animation style to a node (beta)                                                                                                                                                  |
| `remove_animation_style`       | Remove an applied animation style from a node (beta)                                                                                                                                             |
| `apply_manual_keyframe_track`  | Apply a manual keyframe track to a node property (beta)                                                                                                                                          |
| `remove_manual_keyframe_track` | Remove a manual keyframe track from a node property (beta)                                                                                                                                       |
| `set_timeline_duration`        | Set the duration of a timeline in seconds (beta)                                                                                                                                                 |
| `set_node_visibility`          | Show or hide specific nodes                                                                                                                                                                      |
| `set_text_content`             | Replace the contents of a text node, or the label of a FigJam sticky or shape-with-text                                                                                                          |
| `set_text_properties`          | Patch font, size, alignment, auto-resize, color, and bounds on a text node; font, size and color on FigJam sticky and shape labels                                                               |
| `set_node_properties`          | Patch common node properties — name, position, size, visibility, opacity, corner radius — on one node or a batch (`nodeIds`), checked before any write                                           |
| `set_solid_fill`               | Replace a node's fill or stroke with a single solid paint                                                                                                                                        |
| `set_gradient_fill`            | Replace a node's fill or stroke with a linear/radial/angular/diamond gradient                                                                                                                    |
| `set_effects`                  | Replace a node's effects list (drop/inner shadows, layer/background blurs)                                                                                                                       |
| `set_stroke_properties`        | Patch stroke weight, align, dash pattern, cap, and join                                                                                                                                          |
| `set_auto_layout`              | Configure auto-layout direction, padding, gap, alignment, sizing, and wrap                                                                                                                       |
| `create_page`                  | Create a new page in the document, optionally switching to it                                                                                                                                    |
| `create_frame`                 | Create a new frame, optionally under a parent                                                                                                                                                    |
| `create_text`                  | Create a new text node                                                                                                                                                                           |
| `create_shape`                 | Create a rectangle, ellipse, or line                                                                                                                                                             |
| `create_image`                 | Create an image-backed rectangle from a local path, URL, or data URI                                                                                                                             |
| `create_svg`                   | Insert SVG markup or a workspace `.svg` file (up to 2 MiB) as editable vector layers — design files only ([guide](docs/guides/svg.md))                                                           |
| `import_html_layers`           | Bulk-import an html-figma layer tree (JSON) as frames, text, rectangles, and vectors                                                                                                             |
| `duplicate_nodes`              | Duplicate nodes in place                                                                                                                                                                         |
| `duplicate_with_offset`        | Duplicate nodes and move each copy by a fixed offset in its parent ([guide](docs/guides/layout.md))                                                                                              |
| `distribute_horizontally`      | Space three or more sibling nodes with equal horizontal gaps                                                                                                                                     |
| `distribute_vertically`        | Space three or more sibling nodes with equal vertical gaps                                                                                                                                       |
| `align_to_grid`                | Snap nodes' positions to a grid                                                                                                                                                                  |
| `place_below`                  | Move a node below a sibling, with a gap and start/center alignment                                                                                                                               |
| `place_right_of`               | Move a node right of a sibling, with a gap and start/center alignment                                                                                                                            |
| `fit_to_content`               | Resize a section to wrap its children with padding (design files and FigJam)                                                                                                                     |
| `reparent_nodes`               | Move nodes into another parent                                                                                                                                                                   |
| `group_nodes`                  | Wrap a list of nodes (sharing a parent) in a new group                                                                                                                                           |
| `ungroup_node`                 | Ungroup a group or frame — children move up to its parent                                                                                                                                        |
| `set_selection`                | Set the page selection to a list of node IDs (works in every editor)                                                                                                                             |
| `scroll_and_zoom_into_view`    | Frame the viewport around the given nodes (works in every editor)                                                                                                                                |
| `delete_nodes`                 | Delete nodes with explicit confirmation                                                                                                                                                          |
| `run_script`                   | Execute JavaScript against the Figma Plugin API — the escape hatch for anything the other tools do not cover ([guide](docs/guides/run-script.md))                                                |
| `get_code_connect_map`         | Map Figma components to workspace components, read from local `*.figma.tsx` files ([guide](docs/guides/code-connect.md))                                                                         |
| `get_context_for_code_connect` | A component's properties and variant axes, for authoring a mapping                                                                                                                               |
| `get_code_connect_suggestions` | Propose mappings by matching Figma component names against workspace exports                                                                                                                     |
| `add_code_connect_map`         | Write a Code Connect mapping file into the workspace — a local file, not a Figma cloud record                                                                                                    |
| `whoami`                       | Report the Figma user signed in to the connected plugin                                                                                                                                          |
| `get_libraries`                | List enabled team libraries by their published variable collections, and a collection's variable keys ([guide](docs/guides/libraries.md))                                                        |
| `import_library_asset`         | Import a published component, component set, style or variable by key                                                                                                                            |
| `search_design_system`         | Search components and instances in every open design file (or the ones named in `files`) and published variable collections — scoped, see the guide                                              |
| `create_sticky`                | Create a FigJam sticky note, optionally wide, named and inside a section ([guide](docs/guides/figjam.md))                                                                                        |
| `create_shape_with_text`       | Create a FigJam shape with text inside it, with fill, stroke, rotation and label font/color                                                                                                      |
| `create_connector`             | Connect FigJam nodes or free points, with chosen sides, a label and stroke styling                                                                                                               |
| `create_section`               | Create a section in a FigJam board or design file, with a parent, background and hidden contents                                                                                                 |
| `generate_diagram`             | Render Mermaid source as a FigJam diagram — flowchart, sequence, ER, state, within a documented subset                                                                                           |

All tools accept an optional `fileKey` parameter when multiple Figma files are connected. Use `list_files` to discover connected files and their keys.

### Editing Notes

- The plugin runs in design files, FigJam boards and Slides decks, and tools are gated by editor: `create_page` and the design write tools need a design file, sticky notes, shapes-with-text, connectors and diagrams need FigJam, and Slides support is limited to reads plus edits inside existing slides ([scope](docs/guides/slides.md)). A tool used in the wrong editor is refused up front with a message naming the editor it needs. `list_files` and `get_metadata` report each file's `editorType`.
- The plugin does not run in Dev Mode. Figma does not let one plugin declare both Dev Mode and FigJam, and FigJam won; every read Dev Mode offered works in the design editor.
- The current user must have permission to edit the target file.
- `delete_nodes` is intentionally gated behind `confirm: true`.
- Text edits automatically load the fonts currently used by the target text node before applying the new content.
- New text nodes default to `Inter Regular` unless a font is provided.
- `create_image` reads local paths relative to the MCP server working directory unless you pass an absolute path.
- `create_svg` takes SVG markup or a `.svg` file inside the MCP server working directory — never a URL — up to 2,097,152 UTF-8 bytes, and lets Figma's own importer parse it. It runs in design files only. See [docs/guides/svg.md](docs/guides/svg.md).
- `set_node_properties` with `nodeIds` checks every node and property before writing any, but the Plugin API has no rollback: if Figma itself rejects a value part-way, earlier nodes keep their change.
- The layout helpers (`distribute_*`, `align_to_grid`, `place_*`, `duplicate_with_offset`, `fit_to_content`) work in node-local coordinates, so they need siblings under one parent that is not auto-layout, and refuse rotated nodes where their width and height would mislead. `fit_to_content` moves a section's children to wrap them — it is not a crop. See [docs/guides/layout.md](docs/guides/layout.md).
- `get_prototype_connections`, `trace_prototype_flow` and `get_node`'s `includePrototype` read prototypes exactly as Figma stores them: conditions are returned, never evaluated, and only screen navigations are followed. They are refused in FigJam and Slides. See [docs/guides/prototypes.md](docs/guides/prototypes.md).
- `import_html_layers` takes a JSON file produced by [html-figma](https://github.com/sergcen/html-to-figma)'s browser `htmlToFigma()`. The path resolves relative to the MCP server working directory and must stay inside it, even when absolute. Everything lands inside one wrapper frame, and the response reports `layerCount` against `expectedLayerCount` so partial imports are visible.
- `create_page` returns the new page's ID — pass it as `parentId` to `create_frame` / `create_text` / `create_shape` / `create_image` to author content on that page without switching the editor.
- `run_script` executes agent-authored JavaScript with the full Plugin API in scope. It is the escape hatch for components, variables, styles, boolean operations, prototyping, and any other API the dedicated tools do not cover. Unlike the dedicated tools it is **not atomic** — a script that throws part-way leaves its earlier mutations in the file, because the Plugin API has no rollback. See [docs/guides/run-script.md](docs/guides/run-script.md) for the full contract, limits, and gotchas.
- Serialized nodes carry design-system identity, not just geometry: instances report their main component and set properties, fills bound to variables report the token name, named styles report the style name, and auto-layout children report hug/fill intent. Fields are omitted when a node carries nothing for them, so plain nodes serialize exactly as before. See [docs/reference/serialized-nodes.md](docs/reference/serialized-nodes.md).
- `get_design_context` exports icons and images as files under `assetDir` rather than returning expiring URLs, because a committed file is what code you keep actually needs. The path must stay inside the MCP server working directory. See [docs/guides/design-context.md](docs/guides/design-context.md) for the response contract.
- Code Connect on the relay is entirely local: mappings are read from and written to `*.figma.tsx` files in your repository, never Figma's cloud. There is no `send_code_connect_mappings` equivalent — committing the file is the publish step, which also makes the mapping reviewable. Mapped components show up at the top of `get_design_context`. See [docs/guides/code-connect.md](docs/guides/code-connect.md).
- `generate_diagram` supports flowchart, sequenceDiagram, erDiagram and stateDiagram-v2, each within a documented subset. Anything else — another diagram type, a subgraph, a note, a styling directive — is refused with its line number and nothing is drawn: the relay will not draw an approximation of a diagram it does not understand. See [docs/guides/figjam.md](docs/guides/figjam.md).
- Team library tools (`get_libraries`, `import_library_asset`, `search_design_system`) need the `teamlibrary` permission and a Figma plan that allows team library APIs. Without them `get_libraries` and `import_library_asset` return an explicit error naming the requirement, `search_design_system` falls back to local components and says why, and every other tool is unaffected. `search_design_system` is much narrower than Figma's own: the Plugin API cannot full-text search published component libraries, so it searches components in the open design files — each file's current page, or every page with `allPages: true` — including instances of library components, and published variable collections only, returning one entry per component that points at the original and lists the other files it appears in — an empty result is not proof a component does not exist. See [docs/guides/libraries.md](docs/guides/libraries.md).

### What You Can Build

With the current write surface, an agent can build a basic slide deck in a new empty Figma file: create slide frames, style titles and body copy, lay out rectangles/ellipses/lines for cards and dividers, duplicate slide templates, reparent content into the right frame, and adjust common geometry/visual properties — including solid/gradient paints, shadows and blurs, stroke geometry, and auto-layout configuration.

The current version is intentionally limited — no components/instances, no variables/styles authoring, no per-segment text styling, and no vector boolean operations yet.

## Local development

This repo uses [Bun](https://bun.sh) as its package manager and script runner throughout. Install it first if you don't have it.

#### 1. Clone this repository locally

```bash
git clone git@github.com:SadhuG/figma-design-relay.git
```

#### 2. Install root tooling

Install the root dependencies once. This runs Husky's `prepare` script, which installs the Git pre-commit hook that formats staged files with Prettier.

```bash
cd figma-design-relay && bun install
```

#### 3. Build the server

```bash
cd server && bun install && bun run build
```

#### 4. Build the plugin

```bash
cd plugin && bun install && bun run build
```

#### 5. Add the MCP server to your favourite AI tool

For local development, add the following to your AI tool's MCP config:

```json
{
  "figma-design-relay": {
    "command": "node",
    "args": ["/path/to/figma-design-relay/server/dist/index.js"]
  }
}
```

Keep exactly one such entry for your main checkout, the stable relay. An entry left pointing at an
old clone is how you end up with a relay on 1994 that is not the code you just built. Feature work
gets entries of its own under different names; see the next step.

#### 6. Stable and dev plugins side by side

The main checkout is the **stable** relay: it runs on port **1994** and appears in Figma as
**Figma Design Relay**. Every feature is built in its own git worktree holding a **dev slot**, which
gives it a plugin name, plugin id and port of its own:

```bash
git worktree add --no-track -b feat/<feature> ../figma-design-relay-<feature> origin/main
cd ../figma-design-relay-<feature> && bun install
bun scripts/dev-slot.mjs      # writes .dev-slot.json and prints the next steps
```

That worktree's builds then produce **Figma Design Relay (Dev: _feature_, port _port_)** on a
port from 1995–2019 (the name carries the port, so the Development menu says which relay it
dials): the plugin build writes its manifest to `plugin/dist/manifest.json` (import that one in
Figma), and the server listens on the slot's port by itself (add it to your MCP config as
`figma-design-relay-dev-<feature>`). Stable and dev relays never talk to each other, so a
half-built feature cannot break the plugin you use for real work. The
[`start-feature` skill](.claude/skills/start-feature/SKILL.md) has the full procedure, including
tearing a slot down after the merge.

The plugin panel's **Relay** row shows the address a running plugin is dialing. The smoke-test
probes in `server/.smoke/` follow the slot too. `FIGMA_DESIGN_RELAY_PORT` and `SMOKE_PORT` still
override the port, but only 1994 and a slot's own port have a plugin that can dial them — the stable
manifest allows 1994 alone, and a slotted build refuses any other address — so treat them as tools
for tests, not a way to run another plugin.

### Code style

The repo is formatted with [Prettier](https://prettier.io) (config in `.prettierrc`). A Husky pre-commit hook runs `lint-staged`, which formats only your staged files, so commits stay formatted automatically. You can also run it manually:

```bash
bun run format        # format the whole repo
bun run format:check  # verify formatting without writing (useful in CI)
```

### Tests and type-checking

From the repository root, `bun run check` validates versions, runs both test suites, builds both
packages (including type-checking), and checks formatting. `bun run test` runs only the suites.

```bash
bun test ./scripts          # the release archive's layout and its refusals (dev-slot builds, wrong port,
                            # missing shebang, missing runtime or present dev dependencies)
cd server && bun test       # schemas, /rpc guards, codegen, content blocks, asset export, Code Connect,
                            # the Mermaid parser and diagram layout, the startup port and dev slots,
                            # cross-file search: file selection, result merging and fan-out,
                            # bridge response ownership, leader cleanup, filesystem/URL safety and DNS pinning,
                            # dashboard rendering, status guards, activity and follower tracking
                            # the SVG loader, and every new tool follower round trip
cd plugin && bun test       # run_script, serializer and its helpers (FigJam nodes too), Code Connect context,
                            # the editor capability table and its regression guard, diagram payloads,
                            # library tools and search against stubbed figma.teamLibrary / currentUser,
                            # bounded absolute layout geometry, dev slot rules and the dev manifest,
                            # page-loading dispatch, UI startup status and HTML image imports,
                            # prototype scans and traces, SVG placement, property batches,
                            # layout helpers, FigJam text targets and creators,
                            # the panel's theme rules, stylesheet roles, fonts and icons
cd plugin && bun run typecheck   # tsc --noEmit; also runs as part of `bun run build`
```

The plugin's Vite build compiles with esbuild, which strips types without checking them, so
`bun run build` runs the type-check first and stops before Vite if it fails. The server needs no
separate step, as its build command is `tsc`.

GitHub Actions runs all of the above on every push and pull request.

## Structure

```
Figma-Design-Relay/
├── .claude/      # For AI agents: CLAUDE.md (project notes), path-scoped rules/ and skills/
├── CHANGELOG.md  # What changed in each version
├── docs/         # guides/ per tool family, reference/, and superpowers/ specs and plans
├── scripts/      # check-version.mjs: one version across server, plugin and changelog;
│                 # dev-slot.mjs: claims a feature worktree's dev plugin name and port;
│                 # package-release.mjs: stages and checks the release archive
├── plugin/       # Figma plugin (TypeScript/React); src/main/layout-tree.ts: bounded geometry;
│                 # prototype.ts, svg.ts, node-properties.ts, layout-actions.ts and
│                 # text-target.ts: the upstream-synced tools' Figma-free logic;
│                 # read-progress.ts: long-read progress for the panel;
│                 # panel-size.ts: the window's heights; src/ui/theme.ts and
│                 # src/theme-override.ts: Figma's theme and the dev override;
│                 # dev-slot.ts: the slot rules the build uses
└── server/       # MCP server (TypeScript/Node.js)
    ├── dashboard/ # Read-only status page: HTML, CSS, polling and tested render functions
    └── src/
        ├── index.ts      # Entry point
        ├── port.ts       # Startup port: env, else the worktree's dev slot, else 1994
        ├── bridge.ts     # WebSocket bridge to Figma plugin
        ├── leader.ts     # Leader: HTTP server + bridge + dashboard
        ├── activity.ts   # Bounded call history and follower registry
        ├── dashboard-http.ts # Dashboard Host/Origin guard, response headers and file table
        ├── follower.ts   # Follower: proxies to leader via HTTP
        ├── node.ts       # Dynamic leader/follower role switching
        ├── election.ts   # Leader election & health monitoring
        ├── schema.ts     # Tool input schemas & /rpc validation
        ├── tools.ts      # MCP tool definitions
        ├── svg.ts        # create_svg's bounded, workspace-contained source loader
        ├── workspace-path.ts # Shared filesystem containment checks
        ├── image-fetch.ts # DNS-pinned remote image downloads and address checks
        ├── content.ts    # Text and image blocks for tool results
        ├── assets.ts     # Exports design assets into the workspace
        ├── codegen/      # Tokens and React / HTML / CSS reference code
        ├── code-connect/ # Reads, suggests and writes local Code Connect mappings
        ├── mermaid/      # Parses the Mermaid subset and lays diagrams out for FigJam
        ├── search/       # Searches every open design file and merges the answers
        ├── agent.ts      # Cleans the calling client's name for the plugin panel
        └── types.ts      # Shared types
```

## How it works

There are two main components to Figma Design Relay:

### 1. The Figma Plugin

The Figma plugin is the user interface for Figma Design Relay. You run this inside the Figma file you want to use the MCP server for, and its responsible for getting you all the information you need.

### 2. The MCP Server

The MCP server is the core of Figma Design Relay. It maintains a registry of WebSocket connections keyed by `fileKey`, so multiple Figma files can be connected simultaneously. The server is responsible for:

- Handling WebSocket connections from one or more Figma plugin instances
- Routing tool calls to the correct file based on `fileKey`
- Forwarding responses back to the AI client
- Handling leader election (as we can have only one WS connection to an MCP server at a time)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FIGMA (Desktop app)                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Figma Plugin                                  │  │
│  │                    (TypeScript/React)                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ WebSocket
                                      │ (ws://localhost:1994/ws)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRIMARY MCP SERVER                                 │
│                         (Leader on :1994)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Bridge                                    Endpoints:               │    │
│  │  • Manages WebSocket conn                  • /ws    (plugin)        │    │
│  │  • Forwards requests to plugin             • /ping  (health)        │    │
│  │  • Routes responses back                   • /rpc   (followers)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                           ▲                              ▲
                           │ HTTP /rpc                    │ HTTP /rpc
                           │ POST requests                │ POST requests
                           │                              │
         ┌─────────────────┴───────────┐    ┌─────────────┴───────────────┐
         │    FOLLOWER MCP SERVER 1    │    │    FOLLOWER MCP SERVER 2    │
         │                             │    │                             │
         │  • Pings leader /ping       │    │  • Pings leader /ping       │
         │  • Forwards tool calls      │    │  • Forwards tool calls      │
         │    via HTTP /rpc            │    │    via HTTP /rpc            │
         │  • If leader dies →         │    │  • If leader dies →         │
         │    attempts takeover        │    │    attempts takeover        │
         └─────────────────────────────┘    └─────────────────────────────┘
                    ▲                                      ▲
                    │                                      │
                    │ MCP Protocol                         │ MCP Protocol
                    │ (stdio)                              │ (stdio)
                    ▼                                      ▼
         ┌─────────────────────────────┐    ┌─────────────────────────────┐
         │      AI Tool / IDE 1        │    │      AI Tool / IDE 2        │
         │      (e.g., Cursor)         │    │      (e.g., Cursor)         │
         └─────────────────────────────┘    └─────────────────────────────┘
```
