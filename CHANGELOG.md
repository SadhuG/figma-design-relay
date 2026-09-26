# Changelog

All notable changes to Figma Design Relay. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

**How versions move.** Finishing a phase of the
[parity plan set](docs/superpowers/specs/2026-09-01-official-figma-mcp-parity.md) bumps the minor
version. A fix, hardening or tooling change that lands between phases bumps the patch. The server
and the plugin always carry the same version, and `bun scripts/check-version.mjs` (run in CI) fails
if they drift apart or if this file has no entry for them. Work that has landed but not yet been
versioned goes under `Unreleased`.

Versions `0.2.0`–`0.5.0` were assigned retroactively on 2026-09-26. Their tags point at the commit
where each one was reached, but the `package.json` files in those commits still read `0.1.1`,
because nothing bumped them at the time. `0.5.1` is the first version whose `package.json` agrees
with its tag.

## [Unreleased]

## [0.6.1] - 2026-09-26

Fixes from a review of phase 5.

### Added

- `search_design_system` takes a `limit` (default 50, at most 200) and reports `total` when hits
  were cut.

### Fixed

- `search_design_system` found nothing for a query in a non-Latin script and dropped accented
  letters from names; it now strips only whitespace and ASCII punctuation.
- Search ranking scores a full path query (`button/primary`) as exact and ranks whole words (0.9)
  and word prefixes (0.7) above bare substrings.
- Instance main components are resolved 64 at a time instead of all at once; when a whole batch
  fails, the rest are skipped and `instanceError` says to relaunch the plugin.
- Library errors no longer read `Error: <message>.. The key must…`: plain errors lose the name
  prefix and the next step is joined after a single full stop.
- "You do not have permission to access this library" is no longer misreported as a missing
  manifest permission; only a message naming the manifest or the permission is.
- `get_libraries` with a bad `collectionKey` says where a valid key comes from.
- `search_design_system` and `import_library_asset` no longer claim a local component's key is
  importable; only a remote hit's key is known to be published.

## [0.6.0] - 2026-09-26

Phase 5 of the parity plan set: library reach and identity (R36–R42).

### Added

- `whoami` reports the signed-in Figma user, or `user: null` with an explanation.
- `get_libraries` lists enabled team libraries by their published variable collections, and with
  a `collectionKey` lists one collection's variables with their import keys.
- `import_library_asset` imports a published component, component set, style or variable by key
  and returns its id. It is a write, so Dev Mode rejects it.
- `search_design_system` searches components and instances on the current page and published
  variable collections. It is narrower than Figma's own tool and says so: an empty result is not
  proof a component does not exist. Library components are found through their instances.
- `docs/libraries.md` documents all four, their permissions and their limits.

### Changed

- The plugin manifest requests the `currentuser` and `teamlibrary` permissions, which Figma shows
  on import.
- Permission and plan refusals from Figma come back as errors naming the permission, the plan and
  the next step, rather than Figma's raw message.

## [0.5.1] - 2026-09-26

### Fixed

- `get_code_connect_map` no longer hides every mapping when it is called with an `unsaved-…`
  session key as `fileKey`. A node id mapped in several Figma files is now listed under a new
  `ambiguous` field with its candidates, rather than reported as unmapped.

### Changed

- Versions now move with each phase and are recorded in this changelog. `release.yml` reads the
  version from `package.json` instead of taking it as an input, and uses this file's entry as the
  release notes.

## [0.5.0] - 2026-09-25

Phase 4: Code Connect (R28–R35).

### Added

- `get_code_connect_map`: maps Figma components to workspace components, read from local
  `*.figma.tsx` files.
- `get_context_for_code_connect`: a component's properties and variant axes, for writing a
  mapping.
- `get_code_connect_suggestions`: proposes mappings by matching Figma component names against
  workspace exports.
- `add_code_connect_map`: writes a mapping file into the workspace. It is a local file, not a
  Figma cloud record.
- `get_design_context` lists the Code Connect mappings for the components in the tree it returns.
- Figma node URLs are parsed into a file key and a node id.

### Fixed

- The workspace walk is bounded at 10,000 directories and shared between discovery and suggestions.
- Code Connect never matches against an `unsaved-…` session file key.
- Instances of library components that cannot be matched to a mapping are reported as unmatchable
  instead of being skipped silently.
- `figma.connect` calls the scanner loses track of are reported as errors.
- A symlink is refused as a mapping target.
- Generated mappings use prop names and import paths that parse.
- Regex escapes in the import matchers survive the build.

## [0.4.0] - 2026-09-20

Phase 3: design context v2 (R20–R27).

### Added

- `get_design_context` returns reference code, design tokens, exported assets and a screenshot for
  a node in one call.
- Reference code in React, HTML or CSS, generated from the serialized tree and chosen by a format
  dispatcher.
- Design tokens collected from the tree, emitted as `var(--token)` where a variable is bound.
- Icons and images are exported as files under `assetDir`, which must resolve inside the working
  directory.
- Tool results can carry image content blocks.

### Fixed

- The `get_design_context` node id travels on `nodeIds`, so followers forward it.
- A library lookup that fails falls back to the bare id instead of failing the whole call.
- An icon instance is exported as one asset, not one per path.
- An `assetDir` that escapes the working directory is refused before it is created.
- Reference code reads like real data, not fixture data.

### Changed

- One relay on one port, 1994, everywhere. The sources of port confusion were removed.

## [0.3.0] - 2026-09-19

Phase 2: serializer enrichment (R11–R19). The phase's live verification was recorded on
2026-09-24, after this version was reached.

### Added

- Bound variables and style ids are resolved to their names.
- Component and instance identity, including component property definitions.
- Layout intent, prototype reactions, annotations and export settings.
- `docs/serialized-nodes.md` documents the serialized node shape.

### Changed

- The serializer is async and every call site awaits it.
- `FIXED` layout sizing is treated as the default and omitted.

## [0.2.1] - 2026-09-08

Hardening between phases 1 and 2.

### Security

- The leader binds `127.0.0.1` instead of `0.0.0.0`. `/rpc` rejects any request that carries an
  `Origin` header or a non-JSON content type, so neither other hosts on the network nor web pages
  in the browser can drive the relay.

### Added

- The plugin window can collapse to a title bar (merged from upstream).
- CI runs the plugin type-check, both test suites and both builds on every push.

### Fixed

- `run_script` results serialize `Variable` and other objects whose fields are prototype getters.
- The plugin's seven outstanding type errors are cleared.
- URLs and wording left behind by the rename are repaired.

### Changed

- Nothing is published to npm. The GitHub Release is the only distribution channel.
- Line endings are pinned to LF with `.gitattributes`.
- Workflows moved off the Node 20 action runtimes.

## [0.2.0] - 2026-09-07

Phase 1: `run_script`, the Plugin API escape hatch (R1–R10). The first version of this fork.

### Added

- `run_script` runs JavaScript against the Figma Plugin API, with JSON-safe results. It is not
  atomic: a script that throws part-way leaves its earlier changes in the file.
- `bun test` harnesses for the server and the plugin.
- A live smoke-test harness in `server/.smoke/`.

### Changed

- Renamed from Figma MCP Bridge to Figma Design Relay.
- The Dev Mode write gate takes the editor type as a parameter, so it can be unit-tested.

## [0.1.1]

The upstream `@gethopp/figma-mcp-bridge` code this fork started from.

[Unreleased]: https://github.com/SadhuG/figma-design-relay/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/SadhuG/figma-design-relay/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/SadhuG/figma-design-relay/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/SadhuG/figma-design-relay/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/SadhuG/figma-design-relay/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/SadhuG/figma-design-relay/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/SadhuG/figma-design-relay/releases/tag/v0.2.0
