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
  const cards = status.files.map((file) => {
    const last = file.lastCallAt;
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
