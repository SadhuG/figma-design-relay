import { describe, expect, test } from "bun:test";
import {
  THEME_OVERRIDE_KEY,
  createThemeOverrideSaver,
  loadThemeOverride,
  parseThemeOverride,
  saveThemeOverride,
} from "./theme-override";

describe("parseThemeOverride", () => {
  test("keeps light and dark", () => {
    expect(parseThemeOverride("light")).toBe("light");
    expect(parseThemeOverride("dark")).toBe("dark");
  });

  test("treats anything else as following Figma", () => {
    for (const stored of [null, undefined, "blue", 1, {}, "Dark", true]) {
      expect(parseThemeOverride(stored)).toBeNull();
    }
  });

  test("is stored under theme-override", () => {
    expect(THEME_OVERRIDE_KEY).toBe("theme-override");
  });
});

/** A clientStorage stand-in that records every key it is asked for. */
const storage = (stored: unknown, fail = false) => {
  const reads: string[] = [];
  const writes: [string, unknown][] = [];
  return {
    reads,
    writes,
    read: async (key: string) => {
      reads.push(key);
      if (fail) throw new Error("storage unavailable");
      return stored;
    },
    write: async (key: string, value: unknown) => {
      writes.push([key, value]);
      if (fail) throw new Error("storage unavailable");
    },
  };
};

describe("loadThemeOverride", () => {
  test("a stable build never reads the stored override", async () => {
    const store = storage("dark");
    expect(await loadThemeOverride(false, store.read)).toBeNull();
    expect(store.reads).toEqual([]);
  });

  test("a dev build reads and parses it", async () => {
    const store = storage("dark");
    expect(await loadThemeOverride(true, store.read)).toBe("dark");
    expect(store.reads).toEqual([THEME_OVERRIDE_KEY]);
    expect(await loadThemeOverride(true, storage("blue").read)).toBeNull();
  });

  test("a failed read follows Figma instead of throwing", async () => {
    expect(await loadThemeOverride(true, storage(null, true).read)).toBeNull();
  });
});

describe("saveThemeOverride", () => {
  test("a stable build stores nothing and keeps following Figma", async () => {
    const store = storage(null);
    expect(await saveThemeOverride(false, "dark", store.write)).toBeNull();
    expect(store.writes).toEqual([]);
  });

  test("a dev build stores the parsed value", async () => {
    const store = storage(null);
    expect(await saveThemeOverride(true, "light", store.write)).toBe("light");
    expect(await saveThemeOverride(true, "Dark", store.write)).toBeNull();
    expect(store.writes).toEqual([
      [THEME_OVERRIDE_KEY, "light"],
      [THEME_OVERRIDE_KEY, null],
    ]);
  });

  test("a failed write still returns the new value", async () => {
    expect(await saveThemeOverride(true, "dark", storage(null, true).write)).toBe("dark");
  });
});

describe("createThemeOverrideSaver", () => {
  /** Writes that finish only when the test says so, in any order it likes. */
  const deferredWrites = () => {
    const pending: { value: unknown; finish: () => void }[] = [];
    const stored: unknown[] = [];
    const write = (_key: string, value: unknown) =>
      new Promise<void>((resolve) => {
        pending.push({
          value,
          finish: () => {
            stored.push(value);
            resolve();
          },
        });
      });
    return { pending, stored, write };
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("takes the new override at once", () => {
    const save = createThemeOverrideSaver(true, deferredWrites().write);
    expect(save("dark")).toBe("dark");
    expect(save("nonsense")).toBeNull();
  });

  test("rapid clicks are stored in click order, so the last one wins", async () => {
    const io = deferredWrites();
    const save = createThemeOverrideSaver(true, io.write);
    save("dark");
    save("light");
    await tick();
    // Only the first write may be in flight; the second waits for it.
    expect(io.pending.map((write) => write.value)).toEqual(["dark"]);
    io.pending[0].finish();
    await tick();
    expect(io.pending.map((write) => write.value)).toEqual(["dark", "light"]);
    io.pending[1].finish();
    await tick();
    expect(io.stored).toEqual(["dark", "light"]);
  });

  test("a failed write doesn't stop the next one", async () => {
    let calls = 0;
    const stored: unknown[] = [];
    const save = createThemeOverrideSaver(true, async (_key, value) => {
      calls += 1;
      if (calls === 1) throw new Error("storage unavailable");
      stored.push(value);
    });
    save("dark");
    save("light");
    await tick();
    await tick();
    expect(stored).toEqual(["light"]);
  });

  test("a stable build stores nothing and stays on Figma's theme", async () => {
    const io = deferredWrites();
    const save = createThemeOverrideSaver(false, io.write);
    expect(save("dark")).toBeNull();
    await tick();
    expect(io.pending).toEqual([]);
  });
});
