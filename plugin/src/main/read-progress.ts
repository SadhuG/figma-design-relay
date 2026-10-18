// Progress for long layer-tree reads, shown in the panel as Board 10's
// "05 Syncing layers". The serializer calls the reporter once per node; the
// total comes from a cheap synchronous walk that mirrors what it will visit.

export type Countable = { visible?: boolean; children?: readonly Countable[] };

/**
 * How many nodes `serializeNode` will visit for these roots: each root, then visible children
 * only, and no children below a node at `maxDepth`.
 */
export function countNodes(roots: readonly Countable[], maxDepth?: number): number {
  const visit = (node: Countable, depth: number): number => {
    let count = 1;
    if (node.children && (maxDepth === undefined || depth < maxDepth)) {
      for (const child of node.children) {
        if (child.visible !== false) count += visit(child, depth + 1);
      }
    }
    return count;
  };
  return roots.reduce((sum, root) => sum + visit(root, 0), 0);
}

/** The panel needs no more than five updates a second. */
export const PROGRESS_INTERVAL_MS = 200;

/** The fewest steps let through between pauses, so a slow walk still moves. */
export const MIN_BATCH = 50;

/**
 * Returns a tick to call at each serializer checkpoint (a step). A step counts as done once it is
 * let through. Every interval the reporter posts the percent done (when that changed) and opens a
 * pause: ticks then return a promise the step must await before doing its work, which lets the
 * main thread yield so Figma can deliver the message. A walk of resolved promises never yields by
 * itself, and its messages would otherwise all arrive with the response.
 *
 * Steps parked on a pause resume together, before any of them has done its work, so a clock
 * can't tell when to stop them. Instead each pause lets through a batch: as many steps as the
 * last cycle got through per interval (at least MIN_BATCH). A cycle ends when the pause's timer
 * fires, which happens only once the batch's work is done.
 */
export function progressReporter(
  total: number,
  post: (percent: number) => void,
  now: () => number,
  wait: (resume: () => void) => void = (resume) => setTimeout(resume, 0)
): () => Promise<void> | undefined {
  let done = 0;
  let lastPercent = -1;
  let cycleStart = now();
  let admitted = 0;
  let budget = Infinity;
  let pause: Promise<void> | null = null;

  const mustPause = () => total > 0 && (budget <= 0 || now() - cycleStart >= PROGRESS_INTERVAL_MS);
  const checkpoint = () => {
    const percent = Math.min(100, Math.floor((done / total) * 100));
    if (percent !== lastPercent) {
      lastPercent = percent;
      post(percent);
    }
    let end = () => {};
    pause = new Promise<void>((resolve) => (end = resolve));
    wait(() => {
      const at = now();
      const took = Math.max(1, at - cycleStart);
      budget = Math.max(MIN_BATCH, Math.floor((admitted * PROGRESS_INTERVAL_MS) / took));
      cycleStart = at;
      admitted = 0;
      pause = null;
      end();
    });
  };
  const admit = () => {
    done++;
    admitted++;
    budget--;
  };
  const waitTurn = async () => {
    while (pause) {
      await pause;
      if (!pause && mustPause()) checkpoint();
    }
    admit();
  };

  return () => {
    if (!pause && mustPause()) checkpoint();
    if (pause) return waitTurn();
    admit();
    return undefined;
  };
}
