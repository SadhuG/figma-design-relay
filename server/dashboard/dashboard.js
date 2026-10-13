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
