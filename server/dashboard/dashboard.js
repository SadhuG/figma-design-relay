import { renderActivity, renderFiles, renderFollowers, renderHeader } from "./render.js";

const POLL_MS = 2_000;
/** Find a control or output region defined by the dashboard's static HTML shell. */
const byId = (id) => document.getElementById(id);
let latest = null;

/** Render the latest successful snapshot using the current failed-call filter. */
function draw() {
  const errorsOnly = byId("errors-only").checked;
  byId("header").innerHTML = renderHeader(latest);
  byId("files").innerHTML = renderFiles(latest);
  byId("activity").innerHTML = renderActivity(latest, { errorsOnly });
  byId("followers").innerHTML = renderFollowers(latest);
}

/**
 * Fetch one uncached snapshot and schedule the next attempt after it settles.
 * Preserve the last view on failure; clear the offline banner when any leader answers again.
 */
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
