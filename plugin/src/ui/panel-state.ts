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

/** How long to wait before each reconnect attempt; the last value repeats. */
export const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000] as const;

/** Attempt 0 is the first retry after a drop. */
export function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

export type ChipTone = "live" | "working" | "lost";

export type ChipInput = {
  connected: boolean;
  port: string;
  /** From workingLabel; null when no agent is working. */
  workingLabel: string | null;
  /** Seconds until the next attempt; null or 0 while an attempt is under way. */
  retryInSeconds: number | null;
};

/** `text` is for the open panel, `short` for the collapsed bar. Lost beats working beats live. */
export function chipState(input: ChipInput): { tone: ChipTone; text: string; short: string } {
  if (!input.connected) {
    const text = input.retryInSeconds
      ? `Lost the relay · retrying in ${input.retryInSeconds} s`
      : "Lost the relay · retrying…";
    return { tone: "lost", text, short: "Retrying…" };
  }
  if (input.workingLabel) {
    return { tone: "working", text: input.workingLabel, short: input.workingLabel };
  }
  return { tone: "live", text: `Live on port ${input.port}`, short: `Live · ${input.port}` };
}
