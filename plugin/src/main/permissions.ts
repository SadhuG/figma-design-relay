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

/**
 * Maps a thrown value to an actionable message.
 * @param error - Whatever was thrown.
 * @param api - The API surface the call belonged to.
 * @returns The message to surface, unchanged when the error is unrelated.
 */
export const describeApiError = (error: unknown, api: GatedApi): string => {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const text = error instanceof Error ? error.message : String(error);

  if (/permission/i.test(text)) {
    return (
      `Figma refused the ${api} call because the plugin does not have the ` +
      `"${MANIFEST_PERMISSION[api]}" permission. Add it to the "permissions" array in ` +
      `plugin/manifest.json, rebuild the plugin, and re-import it in Figma.`
    );
  }

  // Word boundaries so "explanation" and the like do not read as a plan refusal.
  if (/\b(organization|enterprise|plans?)\b/i.test(text)) {
    return (
      `Figma refused the ${api} call because it is not available on this account's plan ` +
      `(Figma said: "${text}"). Team library APIs need the "${MANIFEST_PERMISSION[api]}" ` +
      `permission and a Figma plan that includes team libraries. Every other relay tool ` +
      `still works; open the library file itself with the plugin to read its contents.`
    );
  }

  return raw;
};

/**
 * Runs a permission-gated call and rethrows with an actionable message.
 * @param api - The API surface being called.
 * @param fn - The call.
 */
export const withPermissionContext = async <T>(api: GatedApi, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    throw new Error(describeApiError(error, api));
  }
};
