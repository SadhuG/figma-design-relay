import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Directories never worth walking. `node_modules` alone can hold hundreds of
 * thousands of files, and a package's own Code Connect fixtures are not the
 * user's mappings.
 */
export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
]);

const CODE_CONNECT = /\.figma\.(ts|tsx|js|jsx)$/;

/**
 * Finds every Code Connect file under `root`.
 *
 * Symlinks that point outside `root` are skipped: discovery must not become a
 * way to read files outside the workspace.
 * @param root - Directory to search, normally the MCP server's working directory.
 * @returns Workspace-relative POSIX paths, sorted.
 */
export const discoverCodeConnectFiles = async (root: string): Promise<string[]> => {
  const base = await realpath(root);
  const found: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(full);
        continue;
      }

      if (!CODE_CONNECT.test(entry.name)) continue;

      let resolved: string;
      try {
        resolved = await realpath(full);
      } catch {
        continue;
      }
      if (resolved !== base && !resolved.startsWith(base + path.sep)) continue;

      found.push(path.relative(base, full).split(path.sep).join("/"));
    }
  };

  await walk(base);
  return found.sort();
};
