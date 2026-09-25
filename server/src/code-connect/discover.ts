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

/**
 * How many directories a walk may enter. A project is far below this; a home
 * directory or `/` — where some MCP clients start their servers — is far above,
 * and walking it on every design-context call would hang until the relay
 * times out.
 */
export const MAX_DIRECTORIES = 10_000;

export interface WalkOptions {
  maxDirectories?: number;
}

/**
 * Visits every file under `root`, skipping `IGNORED_DIRECTORIES` and any link
 * that resolves outside `root`: a walk must not become a way to read files
 * outside the workspace.
 * @param root - Directory to walk, normally the MCP server's working directory.
 * @param accept - Filters files by name before their path is resolved.
 * @param visit - Called with each file's real path and its workspace-relative POSIX path.
 * @throws When the walk enters more than `maxDirectories` directories.
 */
export const walkWorkspace = async (
  root: string,
  accept: (name: string) => boolean,
  visit: (resolved: string, relative: string) => Promise<void> | void,
  { maxDirectories = MAX_DIRECTORIES }: WalkOptions = {}
): Promise<void> => {
  const base = await realpath(root);
  let directories = 0;

  const walk = async (dir: string): Promise<void> => {
    if (++directories > maxDirectories) {
      throw new Error(
        `The MCP server's working directory (${base}) holds more than ${maxDirectories} directories, ` +
          `so it is not a project. Start the server from your project root to use Code Connect.`
      );
    }
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
      if (!accept(entry.name)) continue;

      let resolved: string;
      try {
        resolved = await realpath(full);
      } catch {
        continue;
      }
      if (!resolved.startsWith(base + path.sep)) continue;

      await visit(resolved, path.relative(base, full).split(path.sep).join("/"));
    }
  };

  await walk(base);
};

const CODE_CONNECT = /\.figma\.(ts|tsx|js|jsx)$/;

/**
 * Finds every Code Connect file under `root`.
 * @param root - Directory to search, normally the MCP server's working directory.
 * @param options - The directory budget; see `MAX_DIRECTORIES`.
 * @returns Workspace-relative POSIX paths, sorted.
 */
export const discoverCodeConnectFiles = async (
  root: string,
  options: WalkOptions = {}
): Promise<string[]> => {
  const found: string[] = [];
  await walkWorkspace(
    root,
    (name) => CODE_CONNECT.test(name),
    (_resolved, relative) => {
      found.push(relative);
    },
    options
  );
  return found.sort();
};
