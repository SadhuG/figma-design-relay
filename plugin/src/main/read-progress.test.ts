import { describe, expect, test } from "bun:test";
import { PROGRESS_INTERVAL_MS, countNodes, progressReporter } from "./read-progress";

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
      () => clock
    );
    for (const at of ticks) {
      clock = at;
      tick();
    }
    return posted;
  };

  test("waits an interval before the first post", () =>
    expect(run(10, [0, PROGRESS_INTERVAL_MS - 1])).toEqual([]));
  test("posts the whole percent done", () =>
    expect(run(3, [0, PROGRESS_INTERVAL_MS])).toEqual([66]));
  test("at most one post per interval", () =>
    expect(run(100, [200, 250, 300, 399, 400])).toEqual([1, 5]));
  test("no post when the percent hasn't changed", () =>
    expect(run(1000, [200, 400, 600])).toEqual([0]));
  test("nothing to count never posts", () => expect(run(0, [200, 400])).toEqual([]));
});
