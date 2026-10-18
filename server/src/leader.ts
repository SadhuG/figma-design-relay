import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { FollowerRegistry, INSTANCE_HEADER, readInstance } from "./activity.js";
import type { CallOrigin } from "./activity.js";
import { cleanAgentName } from "./agent.js";
import { Bridge } from "./bridge.js";
import {
  DASHBOARD_DIR,
  DASHBOARD_FILES,
  DASHBOARD_HEADERS,
  STATUS_PATH,
  refuseDashboardRequest,
} from "./dashboard-http.js";
import type { RelayStatus } from "./dashboard-http.js";
import { validateRpc } from "./schema.js";
import { executeSaveScreenshots } from "./tools.js";
import type { ExportFormat } from "./tools.js";
import { LOOPBACK_HOST } from "./types.js";
import type { RPCRequest, RPCResponse } from "./types.js";
import { VERSION } from "./version.js";

/**
 * Leader owns the WebSocket bridge to Figma and exposes HTTP endpoints for followers.
 * Endpoints:
 *   /ws   — WebSocket upgrade for the Figma plugin
 *   /ping — Health check
 *   /rpc  — JSON RPC for follower tool calls
 *   /            — read-only status page (server/dashboard/)
 *   /api/status  — the JSON the page renders
 */
export class Leader {
  private bridge: Bridge;
  private server: http.Server | null = null;
  private followers = new FollowerRegistry();
  private startedAt = 0;

  constructor(private port: number) {
    this.bridge = new Bridge();
  }

  getBridge(): Bridge {
    return this.bridge;
  }

  getFollowers(): FollowerRegistry {
    return this.followers;
  }

  /** The bound address, or null before `start()` resolves. */
  address(): AddressInfo | null {
    const address = this.server?.address() ?? null;
    return typeof address === "string" ? null : address;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === "/ping" && req.method === "GET") {
          this.followers.touch(readInstance(req.headers[INSTANCE_HEADER]), false);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", version: VERSION }));
          return;
        }

        if (req.url === "/rpc" && req.method === "POST") {
          // Only another relay process on this machine may call /rpc. A browser
          // cannot forge either of these: it always attaches Origin to a
          // cross-site POST, and a request that sets application/well-known
          // types other than the CORS-safelisted three is preflighted, which we
          // fail by answering no CORS headers at all.
          if (req.headers.origin !== undefined) {
            this.sendJSON(res, 403, {
              error:
                "/rpc does not accept browser requests. Tool calls must come from a relay process on this machine.",
            });
            return;
          }
          const contentType = req.headers["content-type"] ?? "";
          if (!contentType.split(";")[0].trim().toLowerCase().startsWith("application/json")) {
            this.sendJSON(res, 415, {
              error: "/rpc requires Content-Type: application/json.",
            });
            return;
          }
          this.handleRPC(req, res);
          return;
        }

        if (req.method === "GET") {
          const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
          if (pathname === STATUS_PATH || Object.hasOwn(DASHBOARD_FILES, pathname)) {
            void this.serveDashboard(pathname, req, res);
            return;
          }
        }

        res.writeHead(404);
        res.end("Not found");
      });

      server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
        const pathname = new URL(req.url ?? "", "http://localhost").pathname;
        if (pathname === "/ws") {
          this.bridge.handleUpgrade(req, socket, head);
        } else {
          socket.destroy();
        }
      });

      // Fail fast if port is already in use
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`Port ${this.port} already in use`));
        } else {
          console.error("Leader HTTP server error:", err);
          if (!this.server) reject(err); // reject if during startup
        }
      });

      server.listen(this.port, LOOPBACK_HOST, () => {
        this.server = server;
        this.startedAt = Date.now();
        console.error(`Leader listening on ${LOOPBACK_HOST}:${this.port}`);
        console.error(`Dashboard: http://${LOOPBACK_HOST}:${this.address()?.port ?? this.port}/`);
        resolve();
      });
    });
  }

  private handleRPC(req: http.IncomingMessage, res: http.ServerResponse): void {
    const instance = readInstance(req.headers[INSTANCE_HEADER]);
    this.followers.touch(instance, true);
    const origin: CallOrigin = { kind: "follower", instance };
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const rpcReq: RPCRequest = JSON.parse(body);

        // Handle list_files as a special RPC (not forwarded to plugin)
        if (rpcReq.tool === "list_files") {
          this.sendJSON(res, 200, {
            data: this.bridge.listConnectedFiles(),
          });
          return;
        }

        const validation = validateRpc(rpcReq.tool, rpcReq.nodeIds, rpcReq.params);
        if (validation.error) {
          this.sendJSON(res, 400, { error: validation.error });
          return;
        }

        // Forward the schema's output, not the caller's raw object: schemas may
        // normalise input (e.g. the create_* field aliases), and the plugin only
        // understands the canonical spelling.
        const validatedParams = validation.params ?? rpcReq.params;
        const fileKey = rpcReq.fileKey;
        // Display-only and untrusted: a bad value is dropped, never a reason to refuse the call.
        const agent = cleanAgentName(rpcReq.agent);

        // Currently the only tool that is not forwarded to the plugin is save_screenshots
        // If more are added we need to refactor to a better abstraction.
        if (rpcReq.tool === "save_screenshots") {
          const params = validatedParams ?? {};
          // Create a sender bound to the specific fileKey
          const sender = {
            sendWithParams: (
              requestType: string,
              nodeIds?: string[],
              sendParams?: Record<string, unknown>
            ) =>
              this.bridge.sendWithParams(requestType, nodeIds, sendParams, fileKey, agent, origin),
          };
          const result = await executeSaveScreenshots(
            sender,
            params.items as Parameters<typeof executeSaveScreenshots>[1],
            params.format as ExportFormat | undefined,
            params.scale as number | undefined,
            params.clip as boolean | undefined
          );
          this.sendJSON(res, 200, { data: result });
          return;
        }

        const resp = await this.bridge.sendWithParams(
          rpcReq.tool,
          rpcReq.nodeIds,
          validatedParams,
          fileKey,
          agent,
          origin
        );

        this.sendJSON(res, 200, resp.error ? { error: resp.error } : { data: resp.data });
      } catch (err) {
        this.sendJSON(res, 200, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

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

  private sendJSON(res: http.ServerResponse, status: number, body: RPCResponse): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  stop(): void {
    this.bridge.close();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
