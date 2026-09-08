import { evalDirect } from "./eval-direct";
import { toJsonSafe } from "./script-result";

/** Largest script accepted, in characters. Mirrored by the server's Zod schema. */
export const MAX_SCRIPT_CHARS = 100_000;

/** Largest serialised result returned in full, in characters. */
export const MAX_RESULT_CHARS = 200_000;

export type ScriptOutcome =
  | { ok: true; value?: unknown }
  | { ok: true; truncated: true; valuePreview: string }
  | { ok: false; error: string };

/**
 * Executes agent-authored JavaScript against the Figma Plugin API.
 *
 * The source is wrapped in an async arrow function before evaluation, so the
 * script gets both top-level `await` and top-level `return`.
 *
 * @param code - The script source.
 * @param evaluate - Evaluator, injectable for tests. Defaults to direct eval.
 * @returns The sanitised script value, or a structured failure.
 */
export const runScript = async (
  code: string,
  evaluate: (source: string) => unknown = evalDirect
): Promise<ScriptOutcome> => {
  if (typeof code !== "string" || code.trim() === "") {
    return { ok: false, error: "run_script requires a non-empty `code` string." };
  }
  if (code.length > MAX_SCRIPT_CHARS) {
    return {
      ok: false,
      error:
        `Script is ${code.length} characters; the limit is ${MAX_SCRIPT_CHARS}. ` +
        `Split it into smaller run_script calls.`,
    };
  }

  let value: unknown;
  try {
    const factory = evaluate(`(async () => {\n${code}\n})`);
    if (typeof factory !== "function") {
      return { ok: false, error: "Script did not compile to a callable function." };
    }
    value = await (factory as () => Promise<unknown>)();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  // Round-trip through JSON so the caller can never post a value the
  // WebSocket layer would choke on, and so the cap is measured on the exact
  // bytes that go on the wire.
  const json = JSON.stringify(toJsonSafe(value));
  if (json === undefined) {
    return { ok: true };
  }
  if (json.length > MAX_RESULT_CHARS) {
    return { ok: true, truncated: true, valuePreview: json.slice(0, MAX_RESULT_CHARS) };
  }
  return { ok: true, value: JSON.parse(json) };
};
