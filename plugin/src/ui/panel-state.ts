// The panel's text and timing rules, kept free of React and the DOM so they can
// be unit-tested. App.tsx only wires them up. The design source is the Figma
// frame "Board 10: Plugin UI, final states".

/** "Nothing selected", "1 node", "3 nodes". */
export function formatSelection(count: number): string {
  if (count === 0) return "Nothing selected";
  return count === 1 ? "1 node" : `${count} nodes`;
}

/** The address the plugin dials, connection type included: `ws://localhost:1994`. */
export function relayAddress(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return wsUrl;
  }
}

/** The port the plugin dials, or "" when the URL can't be read. */
export function relayPort(wsUrl: string): string {
  try {
    return new URL(wsUrl).port;
  } catch {
    return "";
  }
}

export function relayRowText(address: string, connected: boolean): string {
  return connected ? address : `${address} (no answer)`;
}
