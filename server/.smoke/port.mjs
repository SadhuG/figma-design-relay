// The one place the smoke harness reads its port from.
//
// Defaults to the relay's stock port, 1994 — the port the MCP client's own
// server and a default plugin build both use — so the harness joins that
// relay as a follower with no special setup. Set SMOKE_PORT to run an isolated
// instance instead; the plugin then has to be built for the same port
// (VITE_FIGMA_DESIGN_RELAY_WS) and manifest.json has to allow it.
export const PORT = process.env.SMOKE_PORT ?? "1994";
