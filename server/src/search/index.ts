import type { BridgeResponse, ConnectedFile } from "../types.js";
import { mergeSearchResults, type MergedSearchResult } from "./merge.js";
import { selectSearchFiles } from "./select-files.js";

/** The two pieces of I/O a search needs, so the fan-out is testable without a relay. */
export interface SearchIo {
  listFiles: () => Promise<ConnectedFile[]>;
  send: (params: Record<string, unknown>, fileKey: string) => Promise<BridgeResponse>;
}

/**
 * Runs `search_design_system` over the selected open files at once and merges the answers.
 * @param io - Lists the connected files and sends one file its request.
 * @param args - The tool's arguments.
 * @returns The merged result.
 * @throws When `fileKey` and `files` are both given, or when no file answered.
 */
export const searchAcrossFiles = async (
  io: SearchIo,
  args: { query: string; limit?: number; allPages?: boolean; fileKey?: string; files?: string[] }
): Promise<MergedSearchResult> => {
  if (args.fileKey !== undefined && args.files !== undefined) {
    throw new Error(
      "Pass fileKey or files, not both: fileKey searches exactly one file, files narrows a search " +
        "across the open files by name or fileKey."
    );
  }

  const { selected, skipped } = selectSearchFiles(await io.listFiles(), args);
  // Exactly what a single-file search sends today, so the plugin needs no change.
  const params = { query: args.query, limit: args.limit, allPages: args.allPages };
  const settled = await Promise.allSettled(selected.map((file) => io.send(params, file.fileKey)));

  const outcomes = selected.map((file, index) => {
    const outcome = settled[index];
    if (outcome.status === "rejected") {
      const reason: unknown = outcome.reason;
      return { file, error: reason instanceof Error ? reason.message : String(reason) };
    }
    if (outcome.value.error) return { file, error: outcome.value.error };
    return { file, result: outcome.value.data };
  });

  return mergeSearchResults({ outcomes, skipped, limit: args.limit, allPages: args.allPages });
};
