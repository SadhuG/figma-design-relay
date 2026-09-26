import { describe, expect, test } from "bun:test";
import { whoami } from "./library";

describe("whoami", () => {
  test("returns the signed-in user's id, name and photo", async () => {
    const result = await whoami(() => ({
      id: "123",
      name: "Ada",
      photoUrl: "https://example.com/ada.png",
      color: "#f00",
      sessionId: 7,
    }));
    expect(result).toEqual({
      user: { id: "123", name: "Ada", photoUrl: "https://example.com/ada.png" },
    });
  });

  test("returns an explicit no-user result rather than an empty object", async () => {
    const result = await whoami(() => null);
    expect(result.user).toBeNull();
    expect(result.note).toContain("currentuser");
  });

  test("maps a permission refusal to the manifest fix", async () => {
    const failing = whoami(() => {
      throw new Error('"currentuser" permission is required to access figma.currentUser');
    });
    await expect(failing).rejects.toThrow(/manifest\.json/);
  });
});
