/**
 * Handlers for phase 5's identity and team-library tools.
 *
 * Every Figma surface is passed in rather than read off the `figma` global, so
 * the suite can drive these with stubbed `currentUser` and `teamLibrary`
 * objects and never needs a Figma session.
 */

import { withPermissionContext } from "./permissions";

/** The fields of Figma's `User` this module reads. */
export interface CurrentUserLike {
  id: string | null;
  name: string;
  photoUrl: string | null;
}

export interface WhoamiResult {
  user: { id: string | null; name: string; photoUrl: string | null } | null;
  note?: string;
}

/**
 * Reports the signed-in user.
 * @param readUser - Reads `figma.currentUser`. A getter, because reading the
 *   property is itself what throws when the permission is missing.
 */
export const whoami = async (readUser: () => CurrentUserLike | null): Promise<WhoamiResult> => {
  const user = await withPermissionContext("currentUser", async () => readUser());
  if (!user) {
    return {
      user: null,
      note:
        "No current user is available. This happens when the plugin runs without the " +
        '"currentuser" permission, or in a context where Figma does not expose one. ' +
        "Relaunch the plugin from this checkout's manifest and retry.",
    };
  }
  return { user: { id: user.id, name: user.name, photoUrl: user.photoUrl } };
};
