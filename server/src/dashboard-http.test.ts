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
