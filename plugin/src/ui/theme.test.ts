import { describe, expect, test } from "bun:test";
import {
  figmaTheme,
  nextOverride,
  resolveTheme,
  type Theme,
  themeRowText,
  watchFigmaTheme,
} from "./theme";

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

describe("resolveTheme", () => {
  test("follows Figma with no override", () => {
    expect(resolveTheme("light", null)).toBe("light");
    expect(resolveTheme("dark", null)).toBe("dark");
  });

  test("an override wins whatever Figma uses", () => {
    expect(resolveTheme("light", "dark")).toBe("dark");
    expect(resolveTheme("dark", "light")).toBe("light");
    expect(resolveTheme("light", "light")).toBe("light");
    expect(resolveTheme("dark", "dark")).toBe("dark");
  });
});

describe("nextOverride", () => {
  test("flipping away from Figma's theme overrides it", () => {
    expect(nextOverride("light", null)).toBe("dark");
    expect(nextOverride("dark", null)).toBe("light");
  });

  test("flipping back onto Figma's theme follows Figma again", () => {
    expect(nextOverride("light", "dark")).toBeNull();
    expect(nextOverride("dark", "light")).toBeNull();
  });

  test("an override Figma has since caught up with flips away from Figma", () => {
    expect(nextOverride("dark", "dark")).toBe("light");
    expect(nextOverride("light", "light")).toBe("dark");
  });
});

describe("themeRowText", () => {
  test("names the theme and where it comes from", () => {
    expect(themeRowText("dark", null)).toBe("Dark · Figma");
    expect(themeRowText("light", null)).toBe("Light · Figma");
    expect(themeRowText("light", "dark")).toBe("Dark · override");
    expect(themeRowText("dark", "light")).toBe("Light · override");
  });

  test("an override stays an override when Figma matches it", () => {
    expect(themeRowText("dark", "dark")).toBe("Dark · override");
  });
});
