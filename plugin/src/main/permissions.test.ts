import { describe, expect, test } from "bun:test";
import { classifyApiError, describeApiError, withPermissionContext } from "./permissions";

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
    expect(message).toBe("No explanation available");
  });

  test("does not read an access refusal as a missing manifest permission", () => {
    const text = "You do not have permission to access this library";
    const message = describeApiError(new Error(text), "teamLibrary");
    expect(message).toBe(text);
    expect(classifyApiError(new Error(text))).toBeNull();
  });

  test("recognises Figma's own missing-permission message", () => {
    const error = new Error(
      'in get_teamLibrary: "teamlibrary" permission not specified in manifest.json.'
    );
    expect(classifyApiError(error)).toBe("permission");
  });

  test("classifies a plan refusal", () => {
    expect(classifyApiError(new Error("Only available in Organization plans"))).toBe("plan");
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
