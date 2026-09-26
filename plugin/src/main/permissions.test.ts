import { describe, expect, test } from "bun:test";
import { describeApiError, withPermissionContext } from "./permissions";

describe("describeApiError", () => {
  test("names the permission when the manifest is missing it", () => {
    const message = describeApiError(new Error("Missing permission: teamlibrary"), "teamLibrary");
    expect(message).toContain("teamlibrary");
    expect(message).toContain("manifest.json");
  });

  test("names the plan requirement when the API is plan-gated", () => {
    const message = describeApiError(
      new Error("This API is only available in Organization and Enterprise plans"),
      "teamLibrary"
    );
    expect(message).toMatch(/plan/i);
    expect(message).toContain("teamLibrary");
  });

  test("does not read a plan refusal into a word that merely contains 'plan'", () => {
    const message = describeApiError(new Error("No explanation available"), "teamLibrary");
    expect(message).toBe("Error: No explanation available");
  });

  test("keeps an unrelated error readable rather than reinterpreting it", () => {
    const message = describeApiError(new TypeError("nope"), "currentUser");
    expect(message).toBe("TypeError: nope");
  });

  test("handles a thrown non-Error", () => {
    expect(describeApiError("boom", "currentUser")).toBe("boom");
  });
});

describe("withPermissionContext", () => {
  test("passes a successful result through", async () => {
    expect(await withPermissionContext("teamLibrary", async () => 42)).toBe(42);
  });

  test("rethrows with the mapped message", async () => {
    const failing = withPermissionContext("teamLibrary", async () => {
      throw new Error("Missing permission: teamlibrary");
    });
    await expect(failing).rejects.toThrow(/manifest\.json/);
  });
});
