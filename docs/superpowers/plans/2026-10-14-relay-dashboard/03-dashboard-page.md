# Phase 3 — Dashboard page

[← Overview](00-overview.md)

## Goal and scope

The page a person sees: header, connected-file cards, the tool-call table with a "failed only"
toggle, the follower table, and an offline banner. It polls `/api/status` every two seconds.

**In:** `server/dashboard/render.js` (pure functions, unit-tested), `dashboard.js` (DOM glue),
`dashboard.css`. **Out:** server changes (Phase 2), release packaging and docs (Phase 4).

## Requirements

D2, D3, D4, D5, D9, D10.

## Dependencies

Phase 2: the routes, `index.html` element ids (`header`, `offline`, `files`, `activity`,
`followers`, `errors-only`) and the `RelayStatus` JSON.

## Implementation notes

- All markup comes from `render.js`, which turns a status object into HTML strings and escapes
  every value from Figma or a plugin with `escapeHtml`. `dashboard.js` only fetches and assigns
  `innerHTML`, so everything risky is unit-testable without a DOM. The CSP from Phase 2 blocks inline
  scripts as a second line of defence.
- `render.js` is a plain browser ES module with JSDoc, no TypeScript. Bun's test runner imports it
  directly; it sits outside `tsconfig.json`'s `src/**`, so `tsc` ignores it.
- Relative times use the leader's `now` from the snapshot, not the browser clock.
- Copy is written for designers: name the Figma menu path, not internals.
- `escapeHtml` holds a regex. Write the file with the Write tool, not a heredoc.

## Tasks

### Task 1: Render functions [D2, D3, D4, D5, D9]

**Files:**

- Create: `server/dashboard/render.js`
- Test: `server/dashboard/render.test.ts`

**Interfaces:**

- Consumes: the `RelayStatus` JSON (overview).
- Produces: `escapeHtml(value)`, `editorLabel(editorType)`, `formatDuration(ms)`,
  `formatClock(epochMs)`, `relativeTime(thenMs, nowMs)`, `renderHeader(status)`,
  `renderFiles(status)`, `renderFollowers(status)`,
  `renderActivity(status, { errorsOnly }?)`. Each returns a string.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  editorLabel,
  escapeHtml,
  formatClock,
  formatDuration,
  relativeTime,
  renderActivity,
  renderFiles,
  renderFollowers,
  renderHeader,
} from "./render.js";

const NOW = new Date(2026, 9, 14, 9, 5, 3).getTime();
const HOSTILE = `<img src=x onerror="alert(1)">`;

function status(overrides: Record<string, unknown> = {}) {
  return {
    version: "0.8.0",
    port: 1994,
    pid: 4100,
    startedAt: NOW - 60_000,
    now: NOW,
    files: [],
    followers: [],
    activity: [],
    ...overrides,
  };
}

function call(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tool: "get_node",
    fileKey: "k1",
    fileName: "Screen",
    origin: { kind: "local" },
    startedAt: NOW - 10_000,
    durationMs: 42,
    ok: true,
    ...overrides,
  };
}

describe("formatting", () => {
  test("escapeHtml escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });

  test("editorLabel names each editor and falls back safely", () => {
    expect(editorLabel("figma")).toBe("Design");
    expect(editorLabel("figjam")).toBe("FigJam");
    expect(editorLabel("slides")).toBe("Slides");
    expect(editorLabel("dev")).toBe("Dev Mode");
    expect(editorLabel(undefined)).toBe("Unknown editor");
    expect(editorLabel("constructor")).toBe("Unknown editor");
  });

  test("durations, clock times and relative times", () => {
    expect(formatDuration(42)).toBe("42 ms");
    expect(formatDuration(1_260)).toBe("1.3 s");
    expect(formatClock(NOW)).toBe("09:05:03");
    expect(relativeTime(NOW - 2_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 30_000, NOW)).toBe("30s ago");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
});

describe("renderHeader", () => {
  test("shows version, port, leader process and start time", () => {
    const html = renderHeader(status());
    expect(html).toContain("v0.8.0");
    expect(html).toContain("port 1994");
    expect(html).toContain("4100");
    expect(html).toContain("09:04:03");
  });
});

describe("renderFiles", () => {
  test("explains how to connect when no file is open, naming the port", () => {
    const html = renderFiles(status());
    expect(html).toContain("No Figma files connected");
    expect(html).toContain("1994");
  });

  test("shows each file's editor, connection time and newest call", () => {
    const html = renderFiles(
      status({
        files: [
          { fileKey: "k1", fileName: "Screen", editorType: "figjam", connectedAt: NOW - 120_000 },
        ],
        activity: [call({ startedAt: NOW - 30_000 }), call({ startedAt: NOW - 90_000 })],
      })
    );
    expect(html).toContain("FigJam");
    expect(html).toContain("Connected 2m ago");
    expect(html).toContain("last call 30s ago");
  });

  test("escapes a hostile file name and error", () => {
    const html =
      renderFiles(status({ files: [{ fileKey: HOSTILE, fileName: HOSTILE, connectedAt: NOW }] })) +
      renderActivity(
        status({ activity: [call({ fileName: HOSTILE, ok: false, error: HOSTILE })] })
      );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("renderActivity", () => {
  test("lists calls with origin, duration and result", () => {
    const html = renderActivity(
      status({
        activity: [
          call({
            ok: false,
            error: "Node not found",
            origin: { kind: "follower", instance: "5151" },
          }),
          call({ fileKey: null, fileName: null }),
        ],
      })
    );
    expect(html).toContain("Follower 5151");
    expect(html).toContain("This relay");
    expect(html).toContain("42 ms");
    expect(html).toContain("Node not found");
    expect(html).toContain("—");
  });

  test("filters to failed calls, with its own empty message", () => {
    const passing = status({ activity: [call()] });
    expect(renderActivity(passing, { errorsOnly: true })).toContain("No failed calls");
    expect(renderActivity(status())).toContain("No tool calls yet");
  });
});

describe("renderFollowers", () => {
  test("explains followers when there are none, and lists them when there are", () => {
    expect(renderFollowers(status())).toContain("No other relay processes");
    const html = renderFollowers(
      status({ followers: [{ instance: "5151", lastSeen: NOW - 3_000, calls: 7 }] })
    );
    expect(html).toContain("5151");
    expect(html).toContain("just now");
    expect(html).toContain(">7<");
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd server && bun test dashboard/render.test.ts`
Expected: FAIL — `Cannot find module './render.js'`.

- [ ] **Step 3: Implement `server/dashboard/render.js`**

```js
// Pure rendering for the relay dashboard: a /api/status snapshot in, HTML
// strings out. Every value that came from Figma or a plugin goes through
// escapeHtml — file names and error text are user-controlled.

const EDITOR_LABELS = { figma: "Design", figjam: "FigJam", slides: "Slides", dev: "Dev Mode" };
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

/** @param {string | undefined} editorType */
export function editorLabel(editorType) {
  return Object.hasOwn(EDITOR_LABELS, String(editorType))
    ? EDITOR_LABELS[editorType]
    : "Unknown editor";
}

/** @param {number} ms */
export function formatDuration(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const pad = (n) => String(n).padStart(2, "0");

/** Local wall-clock time, HH:MM:SS. @param {number} epochMs */
export function formatClock(epochMs) {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** @param {number} thenMs @param {number} nowMs */
export function relativeTime(thenMs, nowMs) {
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function renderHeader(status) {
  return `<h1>Figma Design Relay</h1>
<p class="meta">v${escapeHtml(status.version)} · port ${escapeHtml(status.port)} · leader process ${escapeHtml(status.pid)}, running since ${formatClock(status.startedAt)}</p>`;
}

export function renderFiles(status) {
  if (status.files.length === 0) {
    return `<p class="empty">No Figma files connected. In Figma, open a file and run <strong>Plugins → Development → Figma Design Relay</strong>. The plugin must dial port ${escapeHtml(status.port)}.</p>`;
  }
  // activity is newest first, so the first hit per file is its latest call.
  const lastCall = new Map();
  for (const entry of status.activity) {
    if (entry.fileKey !== null && !lastCall.has(entry.fileKey)) {
      lastCall.set(entry.fileKey, entry.startedAt);
    }
  }
  const cards = status.files.map((file) => {
    const last = lastCall.get(file.fileKey);
    const lastText =
      last === undefined ? "no calls yet" : `last call ${relativeTime(last, status.now)}`;
    return `<li class="card">
<span class="badge badge-${escapeHtml(file.editorType ?? "unknown")}">${escapeHtml(editorLabel(file.editorType))}</span>
<h3>${escapeHtml(file.fileName)}</h3>
<p>Connected ${relativeTime(file.connectedAt, status.now)} · ${lastText}</p>
<code title="The key the relay addresses this file by">${escapeHtml(file.fileKey)}</code>
</li>`;
  });
  return `<ul class="cards">${cards.join("")}</ul>`;
}

export function renderFollowers(status) {
  if (status.followers.length === 0) {
    return `<p class="empty">No other relay processes. Each AI tool session starts one; the extras join this one as followers and send their calls through it.</p>`;
  }
  const rows = status.followers.map(
    (f) =>
      `<tr><td>${escapeHtml(f.instance)}</td><td>${relativeTime(f.lastSeen, status.now)}</td><td>${escapeHtml(f.calls)}</td></tr>`
  );
  return `<table><thead><tr><th>Process</th><th>Last seen</th><th>Tool calls</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function originLabel(origin) {
  return origin.kind === "follower"
    ? `Follower ${escapeHtml(origin.instance ?? "unknown")}`
    : "This relay";
}

export function renderActivity(status, { errorsOnly = false } = {}) {
  const entries = errorsOnly ? status.activity.filter((e) => !e.ok) : status.activity;
  if (entries.length === 0) {
    return errorsOnly
      ? `<p class="empty">No failed calls among the last 200.</p>`
      : `<p class="empty">No tool calls yet. Ask your AI tool to read something from Figma and it appears here.</p>`;
  }
  const rows = entries.map(
    (e) =>
      `<tr class="${e.ok ? "ok" : "failed"}"><td>${formatClock(e.startedAt)}</td><td><code>${escapeHtml(e.tool)}</code></td><td>${e.fileName === null ? "—" : escapeHtml(e.fileName)}</td><td>${originLabel(e.origin)}</td><td>${formatDuration(e.durationMs)}</td><td>${e.ok ? "OK" : escapeHtml(e.error ?? "Failed")}</td></tr>`
  );
  return `<table><thead><tr><th>Time</th><th>Tool</th><th>File</th><th>Via</th><th>Took</th><th>Result</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd server && bun test dashboard/render.test.ts`
Expected: PASS, 10 tests. Then `cd server && bun test`: the whole suite passes.

- [ ] **Step 5: Commit**

```bash
bun run format
git add server/dashboard/render.js server/dashboard/render.test.ts
git commit -m "feat(server): dashboard render functions with escaping"
```

### Task 2: Polling script and styles [D5, D10]

**Files:**

- Create: `server/dashboard/dashboard.js`, `server/dashboard/dashboard.css`

**Interfaces:**

- Consumes: `render.js` exports (Task 1); element ids from Phase 2's `index.html`.
- Produces: the finished page.

This task is DOM glue with no logic worth a unit test. It is verified in a real browser in Step 3.

- [ ] **Step 1: Create `server/dashboard/dashboard.js`**

```js
import { renderActivity, renderFiles, renderFollowers, renderHeader } from "./render.js";

const POLL_MS = 2_000;
const byId = (id) => document.getElementById(id);
let latest = null;

function draw() {
  const errorsOnly = byId("errors-only").checked;
  byId("header").innerHTML = renderHeader(latest);
  byId("files").innerHTML = renderFiles(latest);
  byId("activity").innerHTML = renderActivity(latest, { errorsOnly });
  byId("followers").innerHTML = renderFollowers(latest);
}

// The leader can stop or hand over to another process on the same port; keep
// polling, and let the banner say so until someone answers again.
async function poll() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) throw new Error(`Relay answered ${res.status}`);
    latest = await res.json();
    byId("offline").hidden = true;
    draw();
  } catch {
    byId("offline").hidden = false;
  } finally {
    setTimeout(poll, POLL_MS);
  }
}

byId("errors-only").addEventListener("change", () => {
  if (latest) draw();
});
poll();
```

- [ ] **Step 2: Create `server/dashboard/dashboard.css`**

```css
:root {
  color-scheme: light dark;
  --bg: #f7f7f8;
  --panel: #ffffff;
  --text: #1e1e1e;
  --muted: #6b6b6b;
  --line: #e3e3e6;
  --ok: #14ae5c;
  --fail: #f24822;
  --accent: #0d99ff;
  font:
    14px/1.5 system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1e1e1e;
    --panel: #2c2c2c;
    --text: #f0f0f0;
    --muted: #a0a0a0;
    --line: #3d3d3d;
  }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

header,
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px;
}

h1 {
  margin: 0;
  font-size: 22px;
}

h2 {
  font-size: 16px;
  margin: 0 0 12px;
}

.meta,
.empty,
.card p,
.card code {
  color: var(--muted);
}

section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.banner {
  max-width: 1052px;
  margin: 0 auto 16px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--fail);
  color: #fff;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
}

.card h3 {
  margin: 6px 0 2px;
  font-size: 15px;
  overflow-wrap: anywhere;
}

.card p {
  margin: 0 0 6px;
}

.card code {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--line);
}

.badge-figma {
  background: #e5f4ff;
  color: #0768b5;
}

.badge-figjam {
  background: #fff1d6;
  color: #8a5a00;
}

.badge-slides {
  background: #ffe9e3;
  color: #a33213;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}

th {
  color: var(--muted);
  font-weight: 500;
}

tr.failed td:last-child {
  color: var(--fail);
  overflow-wrap: anywhere;
}

tr.ok td:last-child {
  color: var(--ok);
}
```

- [ ] **Step 3: See the page in a browser**

Start a throwaway leader on a free port from `server/`:

Run: `bun --eval "const { Leader } = await import('./src/leader.ts'); await new Leader(0).start();"`
Expected: stderr prints `Dashboard: http://127.0.0.1:<port>/`; leave it running.

Open that URL (the `t3-code` preview tools, Playwright, or a browser). Check:

- the header shows the version and a process id; "No Figma files connected" names the port;
- "No tool calls yet" and "No other relay processes" show; ticking "Only failed calls" swaps to
  "No failed calls among the last 200";
- the browser console shows no CSP violations;
- stopping the process (Ctrl+C) shows the red banner within ~2 s; starting it again on the same
  port is not possible with port 0, so check recovery in Phase 4's live check instead.

Take a screenshot for the PR.

- [ ] **Step 4: Run the full checks**

Run: `bun run check` from the root.
Expected: tests, version guard, both builds and formatting all pass.

- [ ] **Step 5: Commit**

```bash
bun run format
git add server/dashboard/dashboard.js server/dashboard/dashboard.css
git commit -m "feat(server): dashboard page polls the relay status"
```

## Acceptance checks

- `bun run check` passes from the root.
- The page renders in a browser with no console errors or CSP violations, light and dark.
- `render.test.ts` covers the hostile file name and error (Review Focus 1).
