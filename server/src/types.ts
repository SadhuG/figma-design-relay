/**
 * The interface the HTTP server binds. Loopback only, and deliberately the
 * literal address rather than the name "localhost": /rpc drives every tool,
 * run_script included, with no authentication, so reaching it must require
 * already being on this machine. Followers and the election dial 127.0.0.1 to
 * match — resolving "localhost" can yield ::1 first, which nothing listens on.
 */
export const LOOPBACK_HOST = "127.0.0.1";

export interface BridgeRequest {
  type: string;
  requestId: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
}

export interface BridgeResponse {
  type: string;
  requestId: string;
  data?: unknown;
  error?: string;
}

export interface RPCRequest {
  tool: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
  fileKey?: string;
}

export interface RPCResponse {
  data?: unknown;
  error?: string;
}

export interface ConnectedFile {
  fileKey: string;
  fileName: string;
}

export enum Role {
  Unknown = 0,
  Leader = 1,
  Follower = 2,
}
