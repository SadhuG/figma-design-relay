import { describe, expect, test } from "bun:test";
import { MIN_BATCH, PROGRESS_INTERVAL_MS, countNodes, progressReporter } from "./read-progress";

const leaf = (visible = true) => ({ visible });
const frame = (children: object[], visible = true) => ({ visible, children });

describe("countNodes", () => {
  test("a lone node counts once", () => expect(countNodes([leaf()])).toBe(1));
  test("the whole tree without a depth limit", () =>
    expect(countNodes([frame([leaf(), frame([leaf(), leaf()])])])).toBe(5));
  test("hidden children are skipped, as the serializer skips them", () =>
    expect(countNodes([frame([leaf(false), frame([leaf()], false), leaf()])])).toBe(2));
  test("a node at the depth limit counts, its children don't", () =>
    expect(countNodes([frame([frame([leaf(), leaf()])])], 1)).toBe(2));
  test("depth 0 counts only the roots", () =>
    expect(countNodes([frame([leaf()]), frame([leaf()])], 0)).toBe(2));
  test("several roots add up", () => expect(countNodes([leaf(), frame([leaf()])])).toBe(3));
});

describe("progressReporter", () => {
  const run = (total: number, ticks: number[]) => {
    let clock = 0;
    const posted: number[] = [];
    const tick = progressReporter(
      total,
      (percent) => posted.push(percent),
      () => clock,
      // Pauses end at once here; the "pauses" tests below hold them open.
      (resume) => resume()
    );
    for (const at of ticks) {
      clock = at;
      tick();
    }
    return posted;
  };

  test("waits an interval before the first post", () =>
    expect(run(10, [0, PROGRESS_INTERVAL_MS - 1])).toEqual([]));
  test("posts the percent of nodes let through so far", () =>
    expect(run(3, [0, PROGRESS_INTERVAL_MS])).toEqual([33]));
  test("at most one post per interval", () =>
    expect(run(100, [200, 250, 300, 399, 400])).toEqual([0, 4]));
  test("no post when the percent hasn't changed", () =>
    expect(run(1000, [200, 400, 600])).toEqual([0]));
  test("nothing to count never posts", () => expect(run(0, [200, 400])).toEqual([]));

  // Figma delivers plugin messages only when the main thread yields, and a walk of resolved
  // promises never does. Each interval the reporter opens a pause the nodes wait on.
  describe("pauses", () => {
    const setup = () => {
      let clock = 0;
      let step = 0;
      const waits: (() => void)[] = [];
      const posted: number[] = [];
      const tick = progressReporter(
        1000,
        (percent) => posted.push(percent),
        () => (clock += step),
        (resume) => {
          waits.push(resume);
        }
      );
      return {
        tick,
        waits,
        posted,
        at: (time: number) => (clock = time),
        advanceEachRead: (ms: number) => (step = ms),
      };
    };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    test("ticks inside an interval don't pause", () => {
      const { tick, at } = setup();
      at(100);
      expect(tick()).toBeUndefined();
    });
    test("an interval's end parks every tick until the pause ends", async () => {
      const { tick, at, waits } = setup();
      at(200);
      const through: number[] = [];
      tick()?.then(() => through.push(1));
      at(201);
      tick()?.then(() => through.push(2));
      await flush();
      expect(through).toEqual([]);
      waits[0]();
      await flush();
      expect(through).toEqual([1, 2]);
      expect(tick()).toBeUndefined();
    });
    test("pauses even when the percent hasn't changed", async () => {
      const { tick, at, waits, posted } = setup();
      at(200);
      tick();
      waits[0]();
      await flush();
      at(400);
      expect(tick()).toBeInstanceOf(Promise);
      expect(waits).toHaveLength(2);
      expect(posted).toEqual([0]);
    });
    test("steps resuming together go through in batches, then pause again", async () => {
      const { tick, at, waits } = setup();
      at(200);
      let through = 0;
      for (let i = 0; i < MIN_BATCH * 2; i++) tick()?.then(() => through++);
      waits[0]();
      await flush();
      expect(through).toBe(MIN_BATCH);
      expect(waits).toHaveLength(2);
      waits[1]();
      await flush();
      expect(through).toBe(MIN_BATCH * 2);
    });
    test("the batch grows to what the last cycle managed in an interval", async () => {
      const { tick, at, waits } = setup();
      for (let i = 0; i < 500; i++) tick();
      at(200);
      let through = 0;
      for (let i = 0; i < 1000; i++) tick()?.then(() => through++);
      at(300);
      waits[0]();
      await flush();
      // 500 steps in the 300 ms cycle: about 333 per 200 ms.
      expect(through).toBe(333);
    });
    test("a long burst also pauses again once an interval has passed", async () => {
      const { tick, at, waits, advanceEachRead } = setup();
      at(200);
      const through: number[] = [];
      for (const n of [1, 2, 3]) tick()?.then(() => through.push(n));
      advanceEachRead(250);
      waits[0]();
      await flush();
      expect(waits).toHaveLength(2);
      expect(through.length).toBeLessThan(3);
    });
  });
});
