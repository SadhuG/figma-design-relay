import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/** Checks a path component boundary, including Windows drive and case rules. */
export function isInsideWorkspace(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve links in existing ancestors before a caller creates or reads anything. */
export async function resolveWorkspacePath(
  root: string,
  input: string,
  label: string
): Promise<string> {
  const base = await realpath(root);
  const target = path.resolve(base, input);
  const check = (candidate: string) => {
    if (!isInsideWorkspace(base, candidate)) {
      throw new Error(
        `${label} resolves outside the MCP server working directory (${base}). Choose a path inside the workspace.`
      );
    }
  };
  check(target);
  let ancestor = target;
  for (;;) {
    try {
      check(await realpath(ancestor));
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // ENOENT can also mean a dangling link. Do not walk past a link whose
      // destination cannot be validated; writes would otherwise follow it.
      const entry = await lstat(ancestor).catch((statError: NodeJS.ErrnoException) => {
        if (statError.code !== "ENOENT") throw statError;
        return null;
      });
      if (entry?.isSymbolicLink()) {
        throw new Error(
          `${label} contains an unresolved symbolic link. Choose a path inside the workspace without dangling links.`
        );
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw err;
      ancestor = parent;
    }
  }
}
