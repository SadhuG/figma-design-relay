import { INSTANCE_HEADER, INSTANCE_ID } from "./activity.js";
import type { BridgeResponse, ConnectedFile, RPCRequest, RPCResponse } from "./types.js";

/**
 * Follower proxies MCP tool calls to the leader via HTTP /rpc.
 */
export class Follower {
  constructor(private leaderUrl: string) {}

  /** Proxy a request without params or an agent label through the leader's RPC endpoint. */
  send(requestType: string, nodeIds?: string[], fileKey?: string): Promise<BridgeResponse> {
    return this.sendWithParams(requestType, nodeIds, undefined, fileKey);
  }

  /**
   * Forward tool inputs and an optional agent label with this process's activity identifier.
   * Return the plugin data, or throw the leader's validation/operation error or a transport failure.
   */
  async sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    fileKey?: string,
    agent?: string
  ): Promise<BridgeResponse> {
    const rpcReq: RPCRequest = { tool: requestType };
    if (nodeIds && nodeIds.length > 0) rpcReq.nodeIds = nodeIds;
    if (params && Object.keys(params).length > 0) rpcReq.params = params;
    if (fileKey) rpcReq.fileKey = fileKey;
    if (agent) rpcReq.agent = agent;

    const response = await fetch(`${this.leaderUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [INSTANCE_HEADER]: INSTANCE_ID },
      body: JSON.stringify(rpcReq),
      signal: AbortSignal.timeout(210_000),
    });

    if (!response.ok) {
      // The leader answers validation failures with a 400 whose body names the
      // offending field — surface it instead of a bare status code (#35).
      const body = (await response.json().catch(() => null)) as RPCResponse | null;
      throw new Error(body?.error ?? `Leader returned status ${response.status}`);
    }

    const rpcResp = (await response.json()) as RPCResponse;

    if (rpcResp.error) {
      throw new Error(rpcResp.error);
    }

    return {
      type: requestType,
      requestId: "",
      data: rpcResp.data,
    };
  }

  /** Fetch public connected-file identities via RPC, counting this process as a follower caller. */
  async listConnectedFiles(): Promise<ConnectedFile[]> {
    const response = await fetch(`${this.leaderUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [INSTANCE_HEADER]: INSTANCE_ID },
      body: JSON.stringify({ tool: "list_files" } as RPCRequest),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`Leader returned status ${response.status}`);
    }

    const rpcResp = (await response.json()) as RPCResponse;
    if (rpcResp.error) {
      throw new Error(rpcResp.error);
    }

    return (rpcResp.data as ConnectedFile[]) ?? [];
  }

  /** Send an identified heartbeat; report false on timeout, transport failure or non-OK response. */
  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.leaderUrl}/ping`, {
        headers: { [INSTANCE_HEADER]: INSTANCE_ID },
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
