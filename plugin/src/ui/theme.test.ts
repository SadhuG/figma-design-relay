import { describe, expect, test } from "bun:test";
import { figmaTheme, type Theme, watchFigmaTheme } from "./theme";

/** Stands in for the browser's MutationObserver: `fire` plays a class change back. */
class FakeObserver {
  static last: FakeObserver | null = null;
  observed: { target: unknown; options: MutationObserverInit } | null = null;
  disconnected = false;
  constructor(private readonly callback: () => void) {
    FakeObserver.last = this;
  }
  observe(target: unknown, options: MutationObserverInit) {
    this.observed = { target, options };
  }
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    if (!this.disconnected) this.callback();
  }
}

const fakeRoot = (className: string) => ({ className }) as unknown as HTMLElement;
const Observer = FakeObserver as unknown as typeof MutationObserver;

describe("watchFigmaTheme", () => {
  test("reports the current theme at once", () => {
    const seen: Theme[] = [];
    watchFigmaTheme(fakeRoot("figma-dark"), (theme) => seen.push(theme), Observer);
    expect(seen).toEqual(["dark"]);
  });

  test("reports a class change, watching only the class attribute", () => {
    const root = fakeRoot("figma-light");
    const seen: Theme[] = [];
    watchFigmaTheme(root, (theme) => seen.push(theme), Observer);
    expect(FakeObserver.last?.observed).toEqual({
      target: root,
      options: { attributes: true, attributeFilter: ["class"] },
    });
    root.className = "figma-dark";
    FakeObserver.last?.fire();
    expect(seen).toEqual(["light", "dark"]);
  });

  test("stops after unsubscribe", () => {
    const root = fakeRoot("figma-light");
    const seen: Theme[] = [];
    const stop = watchFigmaTheme(root, (theme) => seen.push(theme), Observer);
    stop();
    root.className = "figma-dark";
    FakeObserver.last?.fire();
    expect(seen).toEqual(["light"]);
    expect(FakeObserver.last?.disconnected).toBe(true);
  });
});

describe("figmaTheme", () => {
  test("reads Figma's dark class", () => {
    expect(figmaTheme("figma-dark")).toBe("dark");
  });

  test("reads Figma's light class", () => {
    expect(figmaTheme("figma-light")).toBe("light");
  });

  test("is light with no theme class (a browser preview, an older Figma)", () => {
    expect(figmaTheme("")).toBe("light");
  });

  test("finds the class among others", () => {
    expect(figmaTheme("foo figma-dark bar")).toBe("dark");
  });

  test("matches a whole class only", () => {
    expect(figmaTheme("figma-darker")).toBe("light");
  });
});
