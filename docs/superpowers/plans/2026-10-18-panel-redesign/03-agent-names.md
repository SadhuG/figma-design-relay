# Phase 3: Agent names

[← Overview](00-overview.md)

**Goal:** The working chip names the agent: "Claude Code is working", or "2 agents working" with
the names in the tooltip. This works whether the agent's server is the leader or a follower.

**In scope:** the server (`types.ts`, `bridge.ts`, `node.ts`, `follower.ts`, `leader.ts`,
`index.ts`) and the plugin UI (`panel-state.ts`, `App.tsx`).
**Out of scope:** counting followers (Board 10 state 08), and any per-agent history or log.

**Depends on:** phases 1 and 2 (`ActivityLog`, `workingLabel`, the chip tooltip).

## How the name travels

1. When an MCP client connects, it sends `clientInfo.name` in its `initialize` request. In the SDK
   that is `server.server.getClientVersion()?.name`, which can be read once
   `server.server.oninitialized` fires.
2. Each server process has one client, so `Node` stores that one name. Every `sendWithParams`
   carries it, both to the leader's `Bridge` and on the follower's `/rpc` body as `agent`.
3. The leader cleans the `agent` from `/rpc` (it is untrusted input) and puts it on the
   `BridgeRequest` the plugin receives.
4. The plugin's UI passes `request.agent` to `ActivityLog.start`. `agentDisplayName` turns the raw
   name into a readable one only when the label is drawn.

The name is display-only. Nothing routes, authorises or logs by it.

## Review focus

1. **A follower on an older build** sends no `agent`. The leader must forward the call unchanged
   and the panel shows "Agent working". Owned by Task 2.
2. **A hostile or broken `agent`** (an object, 10 kB of text, control characters, an empty string)
   must be dropped, not rejected: the tool call itself still runs. Owned by Task 1 and Task 2.
3. **The client never finishes `initialize`,** or sends no `clientInfo`. Requests go out with no
   `agent` and nothing throws. Owned by Task 3.
4. **An older plugin with a newer server** must ignore the extra `agent` field. Nothing to build,
   because the UI already ignores unknown keys. Check it in the live check.
5. **Two sessions of the same app** count as one agent ("Claude Code is working"), not two. This
   is intended. Owned by phase 1's distinct-agents test.

---

### Task 1: Clean the name

**Files:**

- Create: `server/src/agent.ts`
- Test: `server/src/agent.test.ts`

**Interfaces:**

- Produces: `AGENT_NAME_MAX = 64` and `cleanAgentName(raw: unknown): string | undefined`.

- [x] **Step 1: Failing tests.** Each case and its result:
  - `"claude-code"` gives `"claude-code"`.
  - `"  Cursor  "` gives `"Cursor"`.
  - `""`, `"   "`, `42`, `{}` and `undefined` give `undefined`.
  - A name with `\n` or `\u0000` in it comes back with those characters removed.
  - A 200-character name is cut to 64 characters.
- [x] **Step 2: Run to see it fail.** Run `cd server && bun test src/agent.test.ts`. Expected:
      FAIL, the module is missing.
- [x] **Step 3: Implement.** Use `String.raw` for the control-character class, as CLAUDE.md
      requires for regex source, and check the compiled pattern.
- [x] **Step 4: Run to see it pass.** Run `cd server && bun test src/agent.test.ts`. Expected:
      PASS.
- [x] **Step 5: Commit** with `feat(server): clean MCP client names for display`.

### Task 2: Carry the name to the plugin

**Files:**

- Modify:
  - `server/src/types.ts`: `BridgeRequest.agent?: string` and `RPCRequest.agent?: string`.
  - `server/src/bridge.ts`: `sendWithParams(requestType, nodeIds?, params?, fileKey?, agent?: string)`
    sets `request.agent` when present.
  - `server/src/node.ts`: `setAgentName(raw: unknown): void` stores `cleanAgentName(raw)`.
    `sendWithParams` passes it to both paths.
  - `server/src/follower.ts`: `sendWithParams(..., agent?: string)` puts `agent` on the `/rpc`
    body when present.
  - `server/src/leader.ts`: `handleRPC` passes `cleanAgentName(rpcReq.agent)` to
    `bridge.sendWithParams`, including the `save_screenshots` sender.
- Test: `server/src/bridge.test.ts`, `server/src/node.test.ts`, `server/src/leader.test.ts`

**Interfaces:**

- Consumes: `cleanAgentName` (Task 1).
- Produces: `Node.setAgentName(raw: unknown): void`, and the `agent` field on the wire for the
  plugin (Task 4).

- [x] **Step 1: Failing tests.**
  - Bridge: the JSON a fake plugin socket receives has `agent: "claude-code"` when one is passed,
    and no `agent` key when none is.
  - Node, leader role: after `setAgentName("claude-code")`, the request reaching the bridge carries
    it.
  - Leader `/rpc`:
    - `{ tool: "get_selection", agent: "cursor-vscode" }` reaches the plugin with that agent.
    - `{ agent: { evil: true } }` reaches it with no agent, and the call still succeeds.
    - A body with no `agent` field reaches it with no agent.
  - Follower: the `/rpc` body it posts includes `agent` (stub `fetch`, as the existing follower
    tests do, or add the case to `node.test.ts` if that is where follower bodies are checked).
- [x] **Step 2: Run to see them fail.** Run `cd server && bun test`. Expected: the new cases fail.
- [x] **Step 3: Implement** the signatures above.
- [x] **Step 4: Run to see them pass.** Run `cd server && bun test && bun run build`. Expected:
      PASS, and `tsc` is clean.
- [x] **Step 5: Commit** with `feat(server): send the calling agent's name with each request`.

### Task 3: Read the name at initialize

**Files:**

- Modify: `server/src/index.ts`

- [x] **Step 1: Read the name.** After `new McpServer(...)`, set
      `server.server.oninitialized = () => { const info = server.server.getClientVersion(); node.setAgentName(info?.name); console.error(`MCP client: ${info?.name ?? "(none)"} ${info?.version ?? ""}`); }`.
      The log line is how Task 5 finds the real names.
- [x] **Step 2: Verify.** Run `cd server && bun run build`. Expected: PASS.
- [x] **Step 3: Commit** with `feat(server): remember the MCP client's name`.

### Task 4: Readable names in the panel

**Files:**

- Modify: `plugin/src/ui/panel-state.ts`, `plugin/src/ui/App.tsx`
- Test: `plugin/src/ui/panel-state.test.ts`

**Interfaces:**

- Produces: `AGENT_DISPLAY_NAMES: Record<string, string>` and
  `agentDisplayName(raw: string | null): string | null`. A name in the map gives its readable
  form, any other non-empty name comes back as is, and `null` stays `null`.

- [x] **Step 1: Failing tests.**
  - Known names: `claude-code` gives "Claude Code", `cursor-vscode` gives "Cursor",
    `Visual Studio Code` gives "VS Code" and `codex-mcp-client` gives "Codex".
  - An unknown name comes back unchanged, and `null` gives `null`.
  - `workingLabel(["claude-code"].map(agentDisplayName))` gives "Claude Code is working".
- [x] **Step 2: Run to see it fail.** Run `cd plugin && bun test src/ui/panel-state.test.ts`.
      Expected: FAIL.
- [x] **Step 3: Implement and wire.**
  - `ServerRequest` gets `agent?: string`.
  - `ws.onmessage` calls `log.start(id, payload.agent ?? null, now)`.
  - The chip label and its tooltip map names through `agentDisplayName`. With two or more agents,
    the tooltip joins the readable names with ", ", and an unnamed one shows as "Unnamed agent".
- [x] **Step 4: Run to see it pass.** Run `cd plugin && bun test && bun run build`. Expected:
      PASS.
- [x] **Step 5: Commit** with `feat(plugin): name the working agent`.

### Task 5: Check the real names, then the live check

- [x] **Step 1: Read the names live.** Start the dev relay from each MCP client the user has
      (Claude Code at least; ask which others: Cursor, VS Code, Codex). Read the
      `MCP client:` lines from each client's server log.
- [x] **Step 2: Fix the map.** Correct `AGENT_DISPLAY_NAMES` and its tests to the names actually
      seen. Commit with `fix(plugin): agent names as the clients send them`.
- [x] **Step 3: Live check** with `live-figma-check`. Compare each case with its Board 10 card:
  - One client calling: card 03a, with the real readable name.
  - A second client calling within 10 s, through a follower: card 03b, with both names in the
    tooltip.
  - A client whose name is not in the map: card 03d, showing the name as sent.
  - The Dev build: card 03d.
- [x] **Step 4: Record the results** in `live-check.md` next to phase 2's. Then run
      `finish-task`.

## Acceptance checks

- `bun test` passes in `server/` and `plugin/`, `bun run build` passes in both, and `typecheck`
  reports zero errors.
- Live: a leader call and a follower call each show their own app's name. A follower without
  `agent` still works.
- No tool's behaviour changed: the existing server tests pass unchanged.
