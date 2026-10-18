import type http from "node:http";
import type { ActivityEntry, FollowerSeen } from "./activity.js";
import type { ConnectedFile } from "./types.js";

/** What GET /api/status returns; the dashboard page renders exactly this. */
export interface RelayStatus {
  version: string;
  port: number;
  pid: number;
  startedAt: number;
  now: number;
  files: Array<ConnectedFile & { connectedAt: number; lastCallAt?: number }>;
  followers: FollowerSeen[];
  activity: ActivityEntry[];
}

export const STATUS_PATH = "/api/status";

/** server/dashboard/, from src/ under test and from dist/ when built. */
export const DASHBOARD_DIR = new URL("../dashboard/", import.meta.url);

/** The only files the dashboard serves. Never build a path from the URL. */
export const DASHBOARD_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/dashboard.css": { file: "dashboard.css", type: "text/css; charset=utf-8" },
  "/dashboard.js": { file: "dashboard.js", type: "text/javascript; charset=utf-8" },
  "/render.js": { file: "render.js", type: "text/javascript; charset=utf-8" },
};

export const DASHBOARD_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const FOREIGN_SITE = "The relay dashboard does not answer requests from other websites.";

/**
 * Why a dashboard request is refused, or null to serve it. The page is
 * read-only but names the files open in Figma, so no other site may read it —
 * including through DNS rebinding, where the browser sends the attacker's Host.
 */
export function refuseDashboardRequest(
  headers: http.IncomingHttpHeaders,
  port: number,
  isApi: boolean
): string | null {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(headers.host ?? "")) {
    return `Open the relay dashboard at http://127.0.0.1:${port}/ — other host names are refused.`;
  }
  const origin = headers.origin;
  if (origin !== undefined && !hosts.some((host) => origin === `http://${host}`)) {
    return FOREIGN_SITE;
  }
  const site = headers["sec-fetch-site"];
  if (isApi && site !== undefined && site !== "same-origin" && site !== "none") {
    return FOREIGN_SITE;
  }
  return null;
}
