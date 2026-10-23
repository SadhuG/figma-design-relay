# Phase 3: README download and setup

[← Overview](00-overview.md)

## Goal and scope

A user who has never seen the repo goes from the README to a working relay without Bun, a clone or
guessing.

- **In:** README's **Quick Start** (replaced) and a new **Updating** subsection under it; the table
  of contents; any other README line that says `bun install --production`.
- **Out:** Local development (unchanged); `docs/guides/` (no setup content there today).

## Requirements

Quick Start sections, in order:

1. **Requirements** — Node.js 20 or newer (`node --version`), the Figma **desktop app** (importing a
   plugin from a manifest is desktop-only), and an MCP-capable AI tool.
2. **Download** — permanent link
   `https://github.com/SadhuG/figma-design-relay/releases/latest/download/figma-design-relay.zip`, the
   releases page for older versions, unzip into a folder you will keep (examples:
   `~/figma-design-relay`, `C:\Users\<you>\figma-design-relay`). Optional checksum check:
   `shasum -a 256 -c SHA256SUMS.txt` (macOS/Linux), `Get-FileHash figma-design-relay.zip` (Windows).
   One sentence replaces today's npm blockquote: "This fork is distributed only through GitHub
   Releases — there is no npm package or `npx` command."
3. **Connect your AI tool** — `node <folder>/server/dist/index.js`, shown for:
   - Claude Code: `claude mcp add figma-design-relay -- node /absolute/path/figma-design-relay/server/dist/index.js`
   - Claude Desktop, Cursor, Windsurf: JSON **with** the `"mcpServers"` wrapper (today's snippet lacks it).
   - Codex: `~/.codex/config.toml` `[mcp_servers.figma-design-relay]` with `command`/`args`.
   - Windows note: use forward slashes or doubled backslashes in JSON.
4. **Add the Figma plugin** — today's text (import `plugin/manifest.json`, editors, the two
   permissions), kept.
5. **Check it works** — run the plugin, chip says **Live**; ask the agent to call `list_files`; the
   dashboard at `http://127.0.0.1:1994/` (today's step 5 text, trimmed).

**Updating**:

- Get notified: repo → **Watch → Custom → Releases**.
- Quit the AI tool, delete the old `figma-design-relay` folder's contents, unzip the new archive in
  the same place (paths stay the same, so no config change and no re-import), restart the AI tool,
  and re-run the plugin in Figma. `VERSION` and `CHANGELOG.md` in the folder say what you have.
- Why delete first: unzipping over the old folder leaves files from removed dependencies behind.

**Troubleshooting** (short list, symptom → fix): `node: command not found` / version below 20;
chip stays **Relay lost** (AI tool not running or MCP entry path wrong — check it ends in
`server/dist/index.js`); `Cannot find module` (folder partly copied — re-unzip the whole archive);
plugin missing from Development menu (import was done in the browser, use the desktop app).

## Tasks

### Task 1: Rewrite Quick Start

**Files:**

- Modify: `README.md:6-14` (table of contents), `README.md:37-87` (Quick Start)

- [ ] **Step 1: Write the sections above**, in the README's existing voice (second person, short
      paragraphs, `###` per step). Keep the panel and dashboard descriptions from today's steps 4–5.

- [ ] **Step 2: Check nothing still tells a user to run Bun**

  Run: `git grep -n "install --production" -- README.md docs/guides`
  Expected: no output.

- [ ] **Step 3: Check every Quick Start path matches the archive**

  Against `.release-test/figma-design-relay/` from phase 1: `server/dist/index.js`,
  `plugin/manifest.json`, `SHA256SUMS.txt` naming (asset, not in the folder), `VERSION` all exist as
  written.

- [ ] **Step 4: Format and commit**

  Run: `bun run format` then `bun run format:check`
  Expected: passes.

  ```bash
  git add README.md
  git commit -m "docs: download, setup and update instructions for the release archive"
  ```

## Dependencies

Phase 1 (archive layout), phase 2 (asset names and the permanent link).

## Acceptance checks

- Following Quick Start on a clean machine with only Node and Figma needs no step outside it.
- The permanent download link is the only download URL in Quick Start besides the releases page.
