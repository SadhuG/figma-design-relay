import type { ConnectedFile } from "../types.js";

/** A file that was not searched, and why — reported, never thrown. */
export interface SkippedFile {
  /** Absent when the entry named no connected file. */
  fileKey?: string;
  fileName: string;
  reason: string;
}

export interface FileSelection {
  selected: ConnectedFile[];
  skipped: SkippedFile[];
}

/** Design files hold components; FigJam boards and Slides decks do not. */
const NOT_SEARCHED: Partial<Record<string, string>> = {
  figjam: "a FigJam board",
  slides: "a Slides deck",
};

const openFiles = (connected: readonly ConnectedFile[]): string =>
  connected.length === 0
    ? "No files are open with the plugin."
    : `Open files: ${connected
        .map((file) => `"${file.fileName}" (fileKey: ${file.fileKey})`)
        .join(", ")}.`;

const comparable = (name: string): string => name.trim().toLowerCase();

/**
 * Picks the connected files a search covers.
 * @param connected - The files `list_files` reports, in connection order.
 * @param request - `fileKey` for exactly one file, `files` to narrow by name or fileKey, or
 * neither for every design file.
 * @returns The files to search, in connection order, and the ones left out with a reason.
 */
export const selectSearchFiles = (
  connected: readonly ConnectedFile[],
  request: { fileKey?: string; files?: readonly string[] }
): FileSelection => {
  const selected: ConnectedFile[] = [];
  const skipped: SkippedFile[] = [];

  // fileKey keeps its old meaning — exactly this file — so it bypasses the editor filter.
  if (request.fileKey !== undefined) {
    const file = connected.find((entry) => entry.fileKey === request.fileKey);
    if (file) selected.push(file);
    else {
      skipped.push({
        fileName: request.fileKey,
        reason: `No plugin connected for fileKey "${request.fileKey}". ${openFiles(connected)}`,
      });
    }
    return { selected, skipped };
  }

  const take = (file: ConnectedFile): void => {
    const seen = [...selected, ...skipped].some((entry) => entry.fileKey === file.fileKey);
    if (seen) return;
    const editor = file.editorType ? NOT_SEARCHED[file.editorType] : undefined;
    if (editor) {
      skipped.push({
        fileKey: file.fileKey,
        fileName: file.fileName,
        reason:
          `Skipped: ${editor}. Only design files hold components to search. Open a design ` +
          `file and run the plugin there, or pass it as \`fileKey\` (not in \`files\`) to ` +
          `search this one anyway.`,
      });
      return;
    }
    selected.push(file);
  };

  if (request.files === undefined) {
    connected.forEach(take);
    return { selected, skipped };
  }

  const missing = new Set<string>();
  for (const entry of request.files) {
    const wanted = comparable(entry);
    const matches = connected.filter(
      (file) => file.fileKey === entry.trim() || comparable(file.fileName) === wanted
    );
    if (matches.length > 0) {
      matches.forEach(take);
    } else if (!missing.has(wanted)) {
      missing.add(wanted);
      skipped.push({
        fileName: entry,
        reason: `Not open with the plugin. ${openFiles(connected)}`,
      });
    }
  }
  // The merge picks an original by file order, so the order the files were named must not matter.
  const order = (file: ConnectedFile): number => connected.indexOf(file);
  selected.sort((a, b) => order(a) - order(b));
  return { selected, skipped };
};
