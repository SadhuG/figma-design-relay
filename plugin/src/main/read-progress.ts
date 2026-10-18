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

/**
 * Returns a tick to call once per serialized node. It posts the whole percent done when the
 * percent has changed and an interval has passed since the last post (or since the start).
 */
export function progressReporter(
  total: number,
  post: (percent: number) => void,
  now: () => number
): () => void {
  let done = 0;
  let lastPercent = -1;
  let lastPostAt = now();
  return () => {
    done++;
    if (total <= 0) return;
    const at = now();
    if (at - lastPostAt < PROGRESS_INTERVAL_MS) return;
    const percent = Math.min(100, Math.floor((done / total) * 100));
    if (percent === lastPercent) return;
    lastPercent = percent;
    lastPostAt = at;
    post(percent);
  };
}
