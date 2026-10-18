import React, { useEffect, useRef, useState } from "react";
import { ChevronIcon, CursorIcon, LostIcon, PlaneIcon, SunIcon } from "./icons";
import {
  chipState,
  formatSelection,
  relayAddress,
  relayPort,
  relayRowText,
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
    <span className={`chip ${tone}${tone === "live" ? "" : " has-icon"}`} title={title}>
      {tone === "live" && <span className="dot" />}
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
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<PluginStatus>({
    fileName: "Unknown file",
    fileKey: "",
    selectionCount: 0,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const chip = chipState({
    connected,
    port: RELAY_PORT,
    workingLabel: null,
    retryInSeconds: null,
  });
  const chipTitle = WS_BASE_URL;

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
        setConnected(true);
        parent.postMessage({ pluginMessage: { type: "ui-ready" } }, "*");
      };

      ws.onclose = () => {
        if (disposed || socketRef.current !== ws) return;
        setConnected(false);
        if (reconnectTimer.current === null) {
          reconnectTimer.current = window.setTimeout(() => {
            reconnectTimer.current = null;
            connect();
          }, 1500);
        }
      };

      ws.onerror = () => {
        if (disposed || socketRef.current !== ws) return;
        setConnected(false);
      };

      ws.onmessage = (event) => {
        if (disposed || socketRef.current !== ws) return;
        const payload = JSON.parse(event.data) as ServerRequest;
        parent.postMessage({ pluginMessage: { type: "server-request", payload } }, "*");
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
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
          <AppIcon size={20} faded={!connected} />
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
              <span className="row-value">{relayRowText(RELAY_ADDRESS, connected)}</span>
            </div>
          </div>

          <div className="footer">
            <AppIcon size={16} faded={!connected} />
            <Chip tone={chip.tone} text={chip.text} title={chipTitle} />
            <span className="grow" />
            {DEV_SLOT ? <DevPill /> : <span className="version">v{VERSION}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
