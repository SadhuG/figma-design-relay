# Phase 2 — Status endpoint and guard

[← Overview](00-overview.md)

## Goal and scope

The leader answers `GET /api/status` with the `RelayStatus` JSON and serves the page's static files
from `server/dashboard/`, behind a guard that keeps other websites out.

**In:** `server/src/dashboard-http.ts`, the dashboard routes and `status()` in `Leader`, the page's
HTML shell `server/dashboard/index.html`, a startup log line. **Out:** the page's script, styles
and render functions (Phase 3).

## Requirements

D1, D5 (header data), D7, D8, D11.

## Dependencies

Phase 1: `Bridge.getActivity()`, `Bridge.describeConnections()`, `Leader.getFollowers()`.

## Implementation notes

- **Why a Host check:** in a DNS-rebinding attack a page on `evil.example` re-resolves its own name
  to `127.0.0.1`; the browser then treats the relay as same-origin with the attacker but still
  sends `Host: evil.example`. Refusing any Host other than `127.0.0.1:<port>` / `localhost:<port>`
  closes that. The status API also refuses a foreign `Origin` and a cross-site `Sec-Fetch-Site`.
  The page itself (`/`) allows cross-site navigation, so a link from a README still opens it.
- Static files are served from a fixed table (`DASHBOARD_FILES`), never from a path in the URL.
  Look up with `Object.hasOwn` so `/constructor` is a 404, not a prototype hit.
- `DASHBOARD_DIR` is `new URL("../dashboard/", import.meta.url)`. That resolves to
  `server/dashboard/` from both `src/` (tests) and `dist/` (built). Phase 4 adds it to the release.
- The routes are GET only and sit after `/ping` and `/rpc`, so those keep their current behaviour.
- Tests use `node:http` rather than `fetch`, because they must send a forged `Host` header.

## Tasks

### Task 1: The dashboard request guard [D8]

**Files:**

- Create: `server/src/dashboard-http.ts`
- Test: `server/src/dashboard-http.test.ts`

**Interfaces:**

- Produces: `DASHBOARD_HEADERS: Record<string, string>`;
  `DASHBOARD_FILES: Record<string, { file: string; type: string }>`; `STATUS_PATH = "/api/status"`;
  `DASHBOARD_DIR: URL`;
  `refuseDashboardRequest(headers: http.IncomingHttpHeaders, port: number, isApi: boolean): string | null`
  (refusal text, or null to serve); `interface RelayStatus` (shape in the overview).

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { refuseDashboardRequest } from "./dashboard-http.js";

describe("refuseDashboardRequest", () => {
  const PORT = 1994;

  test("serves the relay's own host names", () => {
    expect(refuseDashboardRequest({ host: "127.0.0.1:1994" }, PORT, true)).toBeNull();
    expect(refuseDashboardRequest({ host: "localhost:1994" }, PORT, true)).toBeNull();
  });

  test("refuses other host names, a missing host and another port", () => {
    expect(refuseDashboardRequest({ host: "evil.example:1994" }, PORT, false)).toContain(
      "http://127.0.0.1:1994/"
    );
    expect(refuseDashboardRequest({}, PORT, false)).not.toBeNull();
    expect(refuseDashboardRequest({ host: "127.0.0.1:1995" }, PORT, false)).not.toBeNull();
  });

  test("refuses another site's origin", () => {
    const headers = { host: "127.0.0.1:1994", origin: "https://evil.example" };
    expect(refuseDashboardRequest(headers, PORT, true)).not.toBeNull();
    const own = { host: "127.0.0.1:1994", origin: "http://127.0.0.1:1994" };
    expect(refuseDashboardRequest(own, PORT, true)).toBeNull();
  });

  test("the API refuses cross-site fetches; the page allows cross-site navigation", () => {
    const headers = { host: "127.0.0.1:1994", "sec-fetch-site": "cross-site" };
    expect(refuseDashboardRequest(headers, PORT, true)).not.toBeNull();
    expect(refuseDashboardRequest(headers, PORT, false)).toBeNull();
    const typed = { host: "127.0.0.1:1994", "sec-fetch-site": "none" };
    expect(refuseDashboardRequest(typed, PORT, true)).toBeNull();
  });
});
```

- [x] **Step 2: Run the tests and see them fail**

Run: `cd server && bun test src/dashboard-http.test.ts`
Expected: FAIL — `Cannot find module './dashboard-http.js'`.

- [x] **Step 3: Implement `server/src/dashboard-http.ts`**

```ts
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
  files: Array<ConnectedFile & { connectedAt: number }>;
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
```

- [x] **Step 4: Run the tests and see them pass**

Run: `cd server && bun test src/dashboard-http.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add server/src/dashboard-http.ts server/src/dashboard-http.test.ts
git commit -m "feat(server): dashboard request guard against other sites and DNS rebinding"
```

### Task 2: The leader serves the status and the page [D1, D5, D7, D8, D11]

**Files:**

- Modify: `server/src/leader.ts` (request handler, `start`, new `status()` and `serveDashboard`)
- Create: `server/dashboard/index.html`
- Test: `server/src/dashboard-http.test.ts` (append)

**Interfaces:**

- Consumes: everything from Task 1; `Bridge.getActivity`, `Bridge.describeConnections`,
  `Leader.getFollowers` from Phase 1.
- Produces: `Leader.status(): RelayStatus`; routes `GET /`, `/dashboard.css`, `/dashboard.js`,
  `/render.js`, `/api/status`; element ids `header`, `offline`, `files`, `activity`, `followers`,
  `errors-only` in `index.html` (Phase 3's script uses these).

- [x] **Step 1: Append the failing tests to `server/src/dashboard-http.test.ts`**

Extend the imports:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import http from "node:http";
import { refuseDashboardRequest } from "./dashboard-http.js";
import { Leader } from "./leader.js";
import { VERSION } from "./version.js";
```

```ts
interface RawReply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// fetch will not forge a Host header; node:http will.
function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = "GET"
): Promise<RawReply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("dashboard routes", () => {
  let leader: Leader;
  let port: number;

  beforeAll(async () => {
    leader = new Leader(0);
    await leader.start();
    port = leader.address()!.port;
  });

  afterAll(() => {
    leader.stop();
  });

  test("serves the status snapshot to the dashboard's own origin", async () => {
    const reply = await rawRequest(port, "/api/status");
    expect(reply.status).toBe(200);
    expect(reply.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(reply.headers["access-control-allow-origin"]).toBeUndefined();
    expect(JSON.parse(reply.body)).toMatchObject({
      version: VERSION,
      port,
      pid: process.pid,
      files: [],
      followers: [],
      activity: [],
    });
  });

  test("refuses a rebinding host name", async () => {
    const reply = await rawRequest(port, "/api/status", { Host: `evil.example:${port}` });
    expect(reply.status).toBe(403);
    expect(reply.body).not.toContain("activity");
  });

  test("refuses a cross-site read of the status", async () => {
    const reply = await rawRequest(port, "/api/status", { "Sec-Fetch-Site": "cross-site" });
    expect(reply.status).toBe(403);
  });

  test("serves the page", async () => {
    const reply = await rawRequest(port, "/");
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toContain("text/html");
    expect(reply.body).toContain('<script type="module" src="/dashboard.js"></script>');
  });

  test("answers 404 for anything outside the file table", async () => {
    expect((await rawRequest(port, "/constructor")).status).toBe(404);
    expect((await rawRequest(port, "/../package.json")).status).toBe(404);
    expect((await rawRequest(port, "/", {}, "POST")).status).toBe(404);
  });
});
```

- [x] **Step 2: Run the tests and see them fail**

Run: `cd server && bun test src/dashboard-http.test.ts`
Expected: the 4 guard tests PASS; 4 route tests FAIL with status 404 where 200/403 is expected.
"answers 404 for anything outside the file table" already passes — it guards the change, not the
feature.

- [x] **Step 3: Create `server/dashboard/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Figma Design Relay</title>
    <link rel="stylesheet" href="/dashboard.css" />
    <script type="module" src="/dashboard.js"></script>
  </head>
  <body>
    <header id="header">
      <h1>Figma Design Relay</h1>
      <p class="meta">Connecting to the relay…</p>
    </header>
    <p id="offline" class="banner" role="status" hidden>
      Lost contact with the relay. It may have stopped, or another relay process may be taking over
      as leader. Retrying every 2 seconds…
    </p>
    <main>
      <section aria-labelledby="files-title">
        <h2 id="files-title">Connected files</h2>
        <div id="files"></div>
      </section>
      <section aria-labelledby="activity-title">
        <div class="section-head">
          <h2 id="activity-title">Tool calls</h2>
          <label class="toggle"><input type="checkbox" id="errors-only" /> Only failed calls</label>
        </div>
        <div id="activity"></div>
      </section>
      <section aria-labelledby="followers-title">
        <h2 id="followers-title">Other relay processes</h2>
        <div id="followers"></div>
      </section>
    </main>
  </body>
</html>
```

- [x] **Step 4: Implement the routes in `server/src/leader.ts`**

Imports:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DASHBOARD_DIR,
  DASHBOARD_FILES,
  DASHBOARD_HEADERS,
  STATUS_PATH,
  refuseDashboardRequest,
} from "./dashboard-http.js";
import type { RelayStatus } from "./dashboard-http.js";
```

Add `private startedAt = 0;` beside `followers`, and update the header comment's endpoint list with
`/            — read-only status page (server/dashboard/)` and
`/api/status  — the JSON the page renders`.

In the request handler, between the `/rpc` branch and the 404:

```ts
if (req.method === "GET") {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === STATUS_PATH || Object.hasOwn(DASHBOARD_FILES, pathname)) {
    void this.serveDashboard(pathname, req, res);
    return;
  }
}
```

In the `listen` callback, after `this.server = server;`:

```ts
this.startedAt = Date.now();
console.error(`Dashboard: http://${LOOPBACK_HOST}:${this.address()?.port ?? this.port}/`);
```

New methods, before `sendJSON`:

```ts
  /** What the dashboard shows. Read-only: nothing here reaches the plugin. */
  status(): RelayStatus {
    return {
      version: VERSION,
      port: this.address()?.port ?? this.port,
      pid: process.pid,
      startedAt: this.startedAt,
      now: Date.now(),
      files: this.bridge.describeConnections(),
      followers: this.followers.active(),
      activity: this.bridge.getActivity().recent(),
    };
  }

  private async serveDashboard(
    pathname: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const port = this.address()?.port ?? this.port;
    const isApi = pathname === STATUS_PATH;
    const refusal = refuseDashboardRequest(req.headers, port, isApi);
    if (refusal !== null) {
      res.writeHead(403, { ...DASHBOARD_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end(refusal);
      return;
    }
    if (isApi) {
      res.writeHead(200, { ...DASHBOARD_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify(this.status()));
      return;
    }
    const { file, type } = DASHBOARD_FILES[pathname];
    try {
      const body = await readFile(new URL(file, DASHBOARD_DIR));
      res.writeHead(200, { ...DASHBOARD_HEADERS, "Content-Type": type });
      res.end(body);
    } catch {
      res.writeHead(500, { ...DASHBOARD_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        `The dashboard's files are missing from ${fileURLToPath(DASHBOARD_DIR)}. Rebuild the server, or re-download the release.`
      );
    }
  }
```

- [x] **Step 5: Run the server suite and the type-check**

Run: `cd server && bun test && bun run build`
Expected: all tests PASS (9 in `dashboard-http.test.ts`); `tsc` exits 0.

- [x] **Step 6: Commit**

```bash
bun run format
git add server/src/leader.ts server/src/dashboard-http.test.ts server/dashboard/index.html
git commit -m "feat(server): the leader serves /api/status and the dashboard page"
```

## Acceptance checks

- `cd server && bun test` and `bun run build` pass.
- `curl -s -H "Host: evil.example" http://127.0.0.1:<port>/api/status` against a running dev relay
  prints the refusal text (403), and `curl -s http://127.0.0.1:<port>/api/status` prints JSON.
- The existing `/rpc`, `/ping`, `/ws` and `list_files` tests pass unmodified (D11).
