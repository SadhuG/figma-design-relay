# Spec: Figma Design Relay name change

## Objective

Rename the project from **Figma MCP Bridge** to **Figma Design Relay** across its product surface, source code, package metadata, release workflow, and documentation.

## Canonical naming

| Surface                   | New value                     |
| ------------------------- | ----------------------------- |
| Product name              | `Figma Design Relay`          |
| Repository slug           | `figma-design-relay`          |
| npm package               | `@gethopp/figma-design-relay` |
| CLI executable            | `figma-design-relay`          |
| Plugin package            | `figma-design-relay-plugin`   |
| Figma plugin name         | `Figma Design Relay`          |
| Figma plugin ID           | `figma-design-relay`          |
| MCP configuration key     | `figma-design-relay`          |
| WebSocket build variable  | `VITE_FIGMA_DESIGN_RELAY_WS`  |
| Port environment variable | `FIGMA_DESIGN_RELAY_PORT`     |

## Implementation scope

- Update user-facing headings, titles, labels, descriptions, README examples, and log prefixes.
- Update package names, the CLI `bin` entry, plugin manifest name/ID, MCP server name, lockfiles, and release archive names.
- Update repository, homepage, issue, release, clone, and local-path URLs to the new repository slug.
- Update generated documentation and its source template so regenerated pages keep the new name.
- Remove all legacy `Figma MCP Bridge`, `figma-mcp-bridge`, `figma-bridge`, `FIGMA_BRIDGE_PORT`, and `VITE_FIGMA_BRIDGE_WS` references.

## Compatibility and rollout

This is a breaking package and configuration rename. Existing MCP client configurations using the old package or key, scripts using `figma-mcp-bridge`, and custom environments using the old variable names must be migrated.

1. Rename the GitHub repository to `SadhuG/figma-design-relay` and confirm redirects or update any external links. The upstream `gethopp/figma-mcp-bridge` is unchanged and still live; this project now lives under `SadhuG`.
2. Publish `@gethopp/figma-design-relay` and verify the generated CLI is `figma-design-relay`.
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
- [ ] Confirm the renamed GitHub repository and npm package URLs resolve.

Notes on the two open items:

- The GitHub URLs were pointing at `gethopp/figma-design-relay`, which does not exist — the rename
  swapped the repository name but not the owner. Corrected to `SadhuG/figma-design-relay` in
  `server/package.json`, `README.md`, `docs/superpowers/index.html`, and the plugin's bug-report
  message. `github.com/SadhuG/figma-design-relay` now resolves.
- `@gethopp/figma-design-relay` is still unpublished (the registry returns 404), so the npm half of
  the last item cannot be ticked. **Whether it should publish under the `@gethopp` scope at all is an
  open question**, given the repository now lives under `SadhuG` — publishing to another
  organisation's scope requires membership. The package name is left unchanged pending that
  decision.
- A fresh MCP configuration has been exercised (see `server/.smoke/`), but a genuine multi-file
  connection — two Figma files attached at once, exercising `fileKey` routing — has not.
