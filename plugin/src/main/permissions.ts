/**
 * Turns Figma's refusals into messages an agent can act on.
 *
 * A raw "Missing permission" or "only available in Organization plans" tells
 * the caller nothing about what to do next, and an agent will usually retry the
 * same call. Naming the permission, the plan and the next step stops that.
 */

/** The permission-gated API surfaces this plugin touches. */
export type GatedApi = "teamLibrary" | "currentUser";

const MANIFEST_PERMISSION: Record<GatedApi, string> = {
  teamLibrary: "teamlibrary",
  currentUser: "currentuser",
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Says whether Figma refused a call for a missing manifest permission, for the
 * account's plan, or for neither.
 * @param error - Whatever was thrown.
 */
export const classifyApiError = (error: unknown): "permission" | "plan" | null => {
  const text = messageOf(error);
  // Figma's own refusal names the manifest and the permission
  // ('"teamlibrary" permission not specified in manifest.json'). Requiring that
  // keeps "you do not have permission to access this library" — a sharing
  // problem the manifest cannot fix — out of this branch.
  if (/permission/i.test(text) && /manifest|currentuser|teamlibrary/i.test(text)) {
    return "permission";
  }
  // Word boundaries so "explanation" and the like do not read as a plan refusal.
  if (/\b(organization|enterprise|plans?)\b/i.test(text)) return "plan";
  return null;
};

/**
 * Maps a thrown value to an actionable message.
 * @param error - Whatever was thrown.
 * @param api - The API surface the call belonged to.
 * @returns The message to surface, unchanged when the error is unrelated. A
 *   plain `Error` carries no name prefix, since the relay reports every failure
 *   as an error already; a more specific type such as `TypeError` keeps its name.
 */
export const describeApiError = (error: unknown, api: GatedApi): string => {
  const text = messageOf(error);
  const kind = classifyApiError(error);

  if (kind === "permission") {
    return (
      `Figma refused the ${api} call because the plugin does not have the ` +
      `"${MANIFEST_PERMISSION[api]}" permission. Add it to the "permissions" array in ` +
      `plugin/manifest.json, rebuild the plugin, and relaunch it from Figma's Development menu.`
    );
  }

  if (kind === "plan") {
    return (
      `Figma refused the ${api} call because it is not available on this account's plan ` +
      `(Figma said: "${text}"). Team library APIs need the "${MANIFEST_PERMISSION[api]}" ` +
      `permission and a Figma plan that includes team libraries. Every other relay tool ` +
      `still works; open the library file itself with the plugin to read its contents.`
    );
  }

  return error instanceof Error && error.name !== "Error" ? `${error.name}: ${text}` : text;
};

/**
 * Runs a permission-gated call and rethrows with an actionable message.
 * @param api - The API surface being called.
 * @param fn - The call.
 * @param nextStep - Appended to an error that is neither a permission nor a
 *   plan refusal, which would otherwise reach the agent with no next step.
 */
export const withPermissionContext = async <T>(
  api: GatedApi,
  fn: () => Promise<T>,
  nextStep?: string
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    const message = describeApiError(error, api);
    if (!nextStep || classifyApiError(error)) throw new Error(message);
    // Figma's messages sometimes end in a full stop and sometimes do not.
    throw new Error(`${message.replace(/[.\s]+$/, "")}. ${nextStep}`);
  }
};
