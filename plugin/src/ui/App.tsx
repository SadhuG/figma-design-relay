import React, { useEffect, useRef, useState } from "react";
import { ChevronIcon, CursorIcon, LostIcon, PlaneIcon, SunIcon } from "./icons";
import {
  ActivityLog,
  agentDisplayName,
  agentTooltip,
  chipState,
  formatSelection,
  relayAddress,
  relayPort,
  relayRowText,
  retryDelayMs,
  workingLabel,
  type ChipTone,
} from "./panel-state";

type RequestType =
  | "get_document"
  | "get_selection"
  | "get_node"
  | "get_layout_tree"
  | "get_styles"
  | "get_metadata"
  | "get_design_context"
  | "get_variable_defs"
  | "get_screenshot"
  | "set_node_visibility"
  | "set_text_content"
  | "set_text_properties"
  | "set_node_properties"
  | "set_solid_fill"
  | "set_gradient_fill"
  | "set_effects"
  | "set_stroke_properties"
  | "set_auto_layout"
  | "create_frame"
  | "create_text"
  | "create_shape"
  | "create_image"
  | "duplicate_nodes"
  | "reparent_nodes"
  | "group_nodes"
  | "ungroup_node"
  | "set_selection"
  | "scroll_and_zoom_into_view"
  | "delete_nodes";

type ServerRequest = {
  type: RequestType;
  requestId: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
  /** The calling MCP client's name, when the relay knows it. Display-only. */
  agent?: string;
};

type PluginResponse = {
  type: RequestType;
  requestId: string;
  data?: unknown;
  error?: string;
};

type PluginStatus = {
  fileName: string;
  fileKey: string;
  /** Tells the relay which editor this file is open in, so list_files can say. */
  editorType?: string;
  selectionCount: number;
};

// `||` (not `??`) so an empty build-time value falls back to the default.
// A custom endpoint must also be listed in manifest.json's
// networkAccess.allowedDomains or Figma will block the connection.
const WS_BASE_URL = import.meta.env.VITE_FIGMA_DESIGN_RELAY_WS || "ws://localhost:1994/ws";

// Shown in the panel so a running plugin says which relay it dials. The port is
// baked in at build time, and a build for another port looks identical otherwise.
const RELAY_ADDRESS = relayAddress(WS_BASE_URL);
const RELAY_PORT = relayPort(WS_BASE_URL);

const VERSION = import.meta.env.VITE_FIGMA_DESIGN_RELAY_VERSION ?? "";
/** Set only in a dev slot's build; it switches on the plane icon and the Dev pill. */
const DEV_SLOT = import.meta.env.VITE_FIGMA_DESIGN_RELAY_SLOT;

function AppIcon({ size, faded }: { size: number; faded: boolean }) {
  return (
    <span className={`app-icon${faded ? " faded" : ""}`}>
      {DEV_SLOT ? <PlaneIcon size={size} /> : <SunIcon size={size} />}
    </span>
  );
}

function Chip({ tone, text, title }: { tone: ChipTone; text: string; title: string }) {
  return (
    <span
      className={`chip ${tone}${tone === "working" || tone === "lost" ? " has-icon" : ""}`}
      title={title}
    >
      {(tone === "live" || tone === "connecting") && <span className="dot" />}
      {tone === "working" && <CursorIcon size={14} />}
      {tone === "lost" && <LostIcon size={14} />}
      <span className="chip-text">{text}</span>
    </span>
  );
}

function DevPill() {
  return DEV_SLOT ? <span className="dev-pill">Dev: {DEV_SLOT}</span> : null;
}

export default function App() {
  const [connected, setConnected] = useState(false);
  /** An attempt has failed or a connection dropped; until then the panel is just connecting. */
  const [hasFailed, setHasFailed] = useState(false);
  const lost = !connected && hasFailed;
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<PluginStatus>({
    fileName: "Unknown file",
    fileKey: "",
    selectionCount: 0,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  /** Retries since the last successful connect; picks the next delay. */
  const retryAttempt = useRef(0);
  /** When the pending retry fires, or null while an attempt is under way. */
  const retryDeadline = useRef<number | null>(null);
  /** Set by the socket effect; Retry now calls it. */
  const connectNow = useRef<(() => void) | null>(null);
  const activity = useRef(new ActivityLog());
  const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
  // Bumped whenever the activity log changes or an entry leaves its window.
  const [activityVersion, setActivityVersion] = useState(0);
  const bumpActivity = () => setActivityVersion((version) => version + 1);

  const agents = activity.current.activeAgents(Date.now());
  const chip = chipState({
    connected,
    connecting: !hasFailed,
    port: RELAY_PORT,
    workingLabel: workingLabel(agents.map(agentDisplayName)),
    retryInSeconds,
  });
  const chipTitle = (chip.tone === "working" && agentTooltip(agents)) || WS_BASE_URL;

  // Re-render once when the oldest finished request leaves the working window.
  useEffect(() => {
    const wait = activity.current.nextExpiry(Date.now());
    if (wait === null) return;
    const timer = window.setTimeout(bumpActivity, wait);
    return () => window.clearTimeout(timer);
  }, [activityVersion]);

  // While disconnected, count down to the next attempt once a second.
  useEffect(() => {
    if (connected) return;
    const tick = () => {
      const deadline = retryDeadline.current;
      setRetryInSeconds(
        deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      );
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [connected]);

  const retryNow = () => {
    if (reconnectTimer.current !== null) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    retryAttempt.current = 0;
    retryDeadline.current = null;
    setRetryInSeconds(0);
    connectNow.current?.();
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage;
      if (!msg) return;

      if (msg.type === "plugin-status") {
        setStatus(msg.payload);
        return;
      }

      if (msg.type === "ui-collapse-state") {
        setCollapsed(msg.payload?.collapsed === true);
        return;
      }

      if (!("requestId" in msg)) {
        return;
      }

      // A response on its way back: the request it answers is no longer running.
      activity.current.finish(msg.requestId, Date.now());
      bumpActivity();

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      socketRef.current.send(JSON.stringify(msg));
    };

    window.addEventListener("message", handleMessage);
    // The main thread reads the persisted state asynchronously, so ask for it
    // on mount rather than relying on a broadcast we may have missed.
    parent.postMessage({ pluginMessage: { type: "request-ui-state" } }, "*");
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      parent.postMessage({ pluginMessage: { type: "set-ui-collapsed", collapsed: next } }, "*");
      return next;
    });
  };

  // Connect/reconnect WebSocket when fileKey changes
  useEffect(() => {
    if (!status.fileKey) return;

    let disposed = false;

    const connect = () => {
      if (disposed) return;

      if (socketRef.current) {
        const previousSocket = socketRef.current;
        previousSocket.onopen = null;
        previousSocket.onclose = null;
        previousSocket.onerror = null;
        previousSocket.onmessage = null;
        previousSocket.close();
      }

      const wsUrl = `${WS_BASE_URL}?fileKey=${encodeURIComponent(status.fileKey)}&fileName=${encodeURIComponent(status.fileName)}&editorType=${encodeURIComponent(status.editorType ?? "")}`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        retryAttempt.current = 0;
        retryDeadline.current = null;
        setRetryInSeconds(null);
        setConnected(true);
        parent.postMessage({ pluginMessage: { type: "ui-ready" } }, "*");
      };

      ws.onclose = () => {
        if (disposed || socketRef.current !== ws) return;
        // Responses to requests still in flight will never arrive.
        activity.current.clear();
        bumpActivity();
        setConnected(false);
        setHasFailed(true);
        if (reconnectTimer.current === null) {
          const delay = retryDelayMs(retryAttempt.current++);
          retryDeadline.current = Date.now() + delay;
          setRetryInSeconds(Math.ceil(delay / 1000));
          reconnectTimer.current = window.setTimeout(() => {
            reconnectTimer.current = null;
            retryDeadline.current = null;
            setRetryInSeconds(0);
            connect();
          }, delay);
        }
      };

      ws.onerror = () => {
        if (disposed || socketRef.current !== ws) return;
        setConnected(false);
      };

      ws.onmessage = (event) => {
        if (disposed || socketRef.current !== ws) return;
        const payload = JSON.parse(event.data) as ServerRequest;
        const agent = typeof payload.agent === "string" && payload.agent ? payload.agent : null;
        activity.current.start(payload.requestId, agent, Date.now());
        bumpActivity();
        parent.postMessage({ pluginMessage: { type: "server-request", payload } }, "*");
      };
    };

    connectNow.current = connect;
    connect();

    return () => {
      disposed = true;
      connectNow.current = null;
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      // The next run dials at once, so drop the old countdown and schedule with the timer.
      retryAttempt.current = 0;
      retryDeadline.current = null;
      setRetryInSeconds(0);
      if (socketRef.current) {
        const ws = socketRef.current;
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
        socketRef.current = null;
      }
    };
  }, [status.fileKey, status.fileName, status.editorType]);

  return (
    <div className={`container${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="toggle"
        onClick={toggleCollapsed}
        title={collapsed ? "Expand" : "Collapse"}
        aria-label={collapsed ? "Expand" : "Collapse"}
        aria-expanded={!collapsed}
      >
        <ChevronIcon size={9} direction={collapsed ? "down" : "up"} />
      </button>

      {collapsed ? (
        <div className="bar">
          <AppIcon size={20} faded={lost} />
          <span className="grow" />
          <DevPill />
          <Chip tone={chip.tone} text={chip.short} title={chipTitle} />
        </div>
      ) : (
        <div className="panel">
          <div className="rows">
            <div className="row">
              <span className="row-label">File</span>
              <span className="row-value" title={status.fileName}>
                {status.fileName}
              </span>
            </div>
            <div className="row">
              <span className="row-label">Selection</span>
              <span className="row-value">{formatSelection(status.selectionCount)}</span>
            </div>
            <div className="row">
              <span className="row-label">Relay</span>
              <span className="row-value">{relayRowText(RELAY_ADDRESS, !lost)}</span>
            </div>
          </div>

          <div className="footer">
            <AppIcon size={16} faded={lost} />
            <Chip tone={chip.tone} text={chip.text} title={chipTitle} />
            <span className="grow" />
            {lost ? (
              <button type="button" className="button" onClick={retryNow}>
                Retry now
              </button>
            ) : DEV_SLOT ? (
              <DevPill />
            ) : (
              <span className="version">v{VERSION}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
