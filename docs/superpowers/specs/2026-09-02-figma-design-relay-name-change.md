# Spec: Figma Design Relay name change

## Objective

Rename the project from **Figma MCP Bridge** to **Figma Design Relay** across its product surface, source code, package metadata, release workflow, and documentation.

## Canonical naming

| Surface                   | New value                    |
| ------------------------- | ---------------------------- |
| Product name              | `Figma Design Relay`         |
| Repository slug           | `figma-design-relay`         |
| npm package               | _none — not published_       |
| CLI executable            | `figma-design-relay`         |
| Plugin package            | `figma-design-relay-plugin`  |
| Figma plugin name         | `Figma Design Relay`         |
| Figma plugin ID           | `figma-design-relay`         |
| MCP configuration key     | `figma-design-relay`         |
| WebSocket build variable  | `VITE_FIGMA_DESIGN_RELAY_WS` |
| Port environment variable | `FIGMA_DESIGN_RELAY_PORT`    |

## Implementation scope

- Update user-facing headings, titles, labels, descriptions, README examples, and log prefixes.
- Update package names, the CLI `bin` entry, plugin manifest name/ID, MCP server name, lockfiles, and release archive names.
- Update repository, homepage, issue, release, clone, and local-path URLs to the new repository slug.
- Update generated documentation and its source template so regenerated pages keep the new name.
- Remove all legacy `Figma MCP Bridge`, `figma-mcp-bridge`, `figma-bridge`, `FIGMA_BRIDGE_PORT`, and `VITE_FIGMA_BRIDGE_WS` references.

## Compatibility and rollout

This is a breaking package and configuration rename. Existing MCP client configurations using the old package or key, scripts using `figma-mcp-bridge`, and custom environments using the old variable names must be migrated.

1. Rename the GitHub repository to `SadhuG/figma-design-relay` and confirm redirects or update any external links. The upstream `gethopp/figma-mcp-bridge` is unchanged and still live; this project now lives under `SadhuG`.
2. ~~Publish `@gethopp/figma-design-relay`~~ — resolved as **do not publish**; see the note below.
3. Update MCP client configurations from `figma-bridge` to `figma-design-relay`.
4. Re-import the plugin manifest so Figma registers the new plugin ID.
5. Rename custom build/runtime variables to `VITE_FIGMA_DESIGN_RELAY_WS` and `FIGMA_DESIGN_RELAY_PORT`.
6. Announce the old package and command as retired, with migration guidance for existing users.

## Verification checklist

- [x] No legacy product, slug, MCP key, or environment-variable references remain outside this migration spec.
- [x] README quick-start and local-development instructions use the new names.
- [x] Package, plugin manifest, MCP server, release workflow, and lockfiles are aligned.
- [x] Documentation source and generated HTML use the new product name.
- [x] Install dependencies and run root formatting checks.
- [x] Build the server and plugin.
- [ ] Test a fresh MCP configuration and a multi-file Figma connection.
- [x] Confirm the renamed GitHub repository URL resolves. (The npm half is moot — see the note below.)

Notes on the two open items:

- The GitHub URLs were pointing at `gethopp/figma-design-relay`, which does not exist — the rename
  swapped the repository name but not the owner. Corrected to `SadhuG/figma-design-relay` in
  `server/package.json`, `README.md`, `docs/superpowers/index.html`, and the plugin's bug-report
  message. `github.com/SadhuG/figma-design-relay` now resolves.
- **Resolved: this project does not publish to npm.** The `@gethopp` scope belongs to the upstream
  maintainer (`konsalex`, who publishes `@gethopp/figma-mcp-bridge`), and `@gethopp/figma-design-relay`
  never existed — the registry returned 404. Claiming a name inside another organisation's scope is
  not this fork's to do, and the release workflow could not have authenticated for it anyway: it
  relies on npm trusted publishing (OIDC), which has to be configured on a package by an owner of
  that scope.

  The server package is therefore renamed to `figma-design-relay-server` and marked
  `"private": true`, so `npm publish` refuses it outright. Distribution is the GitHub Release, which
  now carries the built server alongside the built plugin; `README.md`'s Quick Start installs from
  that archive instead of `npx`.

- A fresh MCP configuration has been exercised (see `server/.smoke/`), but a genuine multi-file
  connection — two Figma files attached at once, exercising `fileKey` routing — has not.
