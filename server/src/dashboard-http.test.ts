import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import http from "node:http";
import { refuseDashboardRequest } from "./dashboard-http.js";
import { Leader } from "./leader.js";
import { VERSION } from "./version.js";

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

  test("rejects malformed targets and keeps the leader and host guard working", async () => {
    expect((await rawRequest(port, "//")).status).toBe(400);
    expect((await rawRequest(port, "http://[invalid")).status).toBe(400);
    expect((await rawRequest(port, "/ping")).status).toBe(200);
    expect((await rawRequest(port, "/api/status")).status).toBe(200);
    expect((await rawRequest(port, "/api/status", { Host: "evil.example" })).status).toBe(403);
  });

  test("answers 404 for anything outside the file table", async () => {
    expect((await rawRequest(port, "/constructor")).status).toBe(404);
    expect((await rawRequest(port, "/../package.json")).status).toBe(404);
    expect((await rawRequest(port, "/", {}, "POST")).status).toBe(404);
  });
});
