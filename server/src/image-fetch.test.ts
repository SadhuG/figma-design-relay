import { afterEach, beforeEach, expect, test } from "bun:test";
import type { LookupAddress } from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchImageBytes, type ResolveHost } from "./image-fetch.js";

// The local test server stands in for a public host: the policy below allows
// 127.0.0.1 and blocks everything else, so ::1 plays the internal address.
const allowOnlyTestServer = (address: string) => address !== "127.0.0.1";
const v4: LookupAddress = { address: "127.0.0.1", family: 4 };
const v6: LookupAddress = { address: "::1", family: 6 };

let server: http.Server;
let port: number;
let hits: http.IncomingMessage[];
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeEach(async () => {
  hits = [];
  respond = (_req, res) => res.end("image-bytes");
  server = http.createServer((req, res) => {
    hits.push(req);
    respond(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A resolver that answers from a table, counting lookups per hostname. */
function table(entries: Record<string, LookupAddress[][]>) {
  const calls: Record<string, number> = {};
  const resolve: ResolveHost = async (hostname) => {
    const n = calls[hostname] ?? 0;
    calls[hostname] = n + 1;
    const answers = entries[hostname];
    if (!answers) throw new Error(`unexpected lookup: ${hostname}`);
    return answers[Math.min(n, answers.length - 1)];
  };
  return { resolve, calls };
}

test("connects to the address that passed validation, not a second lookup", async () => {
  // A rebinding resolver: public on the first answer, internal on every later one.
  const { resolve, calls } = table({ "image.relay-test.invalid": [[v4], [v6]] });
  const bytes = await fetchImageBytes(`http://image.relay-test.invalid:${port}/logo.png`, {
    resolve,
    isBlocked: allowOnlyTestServer,
  });
  expect(bytes.toString()).toBe("image-bytes");
  expect(calls["image.relay-test.invalid"]).toBe(1);
  expect(hits).toHaveLength(1);
  // The pinned connection still names the original host.
  expect(hits[0].headers.host).toBe(`image.relay-test.invalid:${port}`);
});

test("refuses a hostname when any of its addresses is blocked, without connecting", async () => {
  const { resolve } = table({ "mixed.relay-test.invalid": [[v4, v6]] });
  await expect(
    fetchImageBytes(`http://mixed.relay-test.invalid:${port}/logo.png`, {
      resolve,
      isBlocked: allowOnlyTestServer,
    })
  ).rejects.toThrow("blocked internal");
  expect(hits).toHaveLength(0);
});

test("revalidates and pins every redirect hop", async () => {
  respond = (_req, res) => {
    res.writeHead(302, { Location: `http://internal.relay-test.invalid:${port}/secret` });
    res.end();
  };
  const { resolve } = table({
    "image.relay-test.invalid": [[v4]],
    "internal.relay-test.invalid": [[v6]],
  });
  await expect(
    fetchImageBytes(`http://image.relay-test.invalid:${port}/logo.png`, {
      resolve,
      isBlocked: allowOnlyTestServer,
    })
  ).rejects.toThrow("blocked internal");
  expect(hits).toHaveLength(1);
});

test("follows a redirect to an allowed host", async () => {
  respond = (req, res) => {
    if (req.url === "/logo.png") {
      res.writeHead(301, { Location: "/final.png" });
      res.end();
    } else {
      res.end("final-bytes");
    }
  };
  const { resolve } = table({ "image.relay-test.invalid": [[v4]] });
  const bytes = await fetchImageBytes(`http://image.relay-test.invalid:${port}/logo.png`, {
    resolve,
    isBlocked: allowOnlyTestServer,
  });
  expect(bytes.toString()).toBe("final-bytes");
  expect(hits.map((hit) => hit.url)).toEqual(["/logo.png", "/final.png"]);
});

test("reports a failing status without reading the body", async () => {
  respond = (_req, res) => {
    res.writeHead(404, "Not Found");
    res.end("missing");
  };
  const { resolve } = table({ "image.relay-test.invalid": [[v4]] });
  await expect(
    fetchImageBytes(`http://image.relay-test.invalid:${port}/logo.png`, {
      resolve,
      isBlocked: allowOnlyTestServer,
    })
  ).rejects.toThrow("Failed to fetch image: 404 Not Found");
});

test("refuses a declared Content-Length over the limit", async () => {
  respond = (_req, res) => {
    res.writeHead(200, { "Content-Length": String(64 * 1024 * 1024) });
    res.write("x");
  };
  const { resolve } = table({ "image.relay-test.invalid": [[v4]] });
  await expect(
    fetchImageBytes(`http://image.relay-test.invalid:${port}/logo.png`, {
      resolve,
      isBlocked: allowOnlyTestServer,
    })
  ).rejects.toThrow("Image exceeds");
});

test("the deadline covers a stalled response body", async () => {
  respond = (_req, res) => {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.write("partial");
  };
  const { resolve } = table({ "image.relay-test.invalid": [[v4]] });
  await expect(
    fetchImageBytes(`http://image.relay-test.invalid:${port}/logo.png`, {
      resolve,
      isBlocked: allowOnlyTestServer,
      timeoutMs: 300,
    })
  ).rejects.toThrow("Timed out fetching image after 300ms");
});

test("literal blocked addresses are refused before any lookup", async () => {
  const { resolve, calls } = table({});
  await expect(
    fetchImageBytes(`http://[::1]:${port}/logo.png`, { resolve, isBlocked: allowOnlyTestServer })
  ).rejects.toThrow("blocked internal");
  expect(calls).toEqual({});
});
