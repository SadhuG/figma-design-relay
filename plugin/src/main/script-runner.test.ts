import { describe, expect, test } from "bun:test";
import { MAX_RESULT_CHARS, MAX_SCRIPT_CHARS, runScript } from "./script-runner";

/**
 * Test evaluator. `runScript`'s production default uses *direct* eval so the
 * Figma sandbox's scope proxy is in scope; under Bun there is no sandbox, so
 * indirect eval is both sufficient and safer to reason about.
 */
const evaluate = (source: string): unknown => (0, eval)(source);

describe("runScript", () => {
  test("returns the script's value", async () => {
    expect(await runScript("return 1 + 1", evaluate)).toEqual({ ok: true, value: 2 });
  });

  test("supports top-level await", async () => {
    const outcome = await runScript("const v = await Promise.resolve('done'); return v", evaluate);
    expect(outcome).toEqual({ ok: true, value: "done" });
  });

  test("returns ok with no value when the script returns nothing", async () => {
    expect(await runScript("const unused = 1;", evaluate)).toEqual({ ok: true });
  });

  test("sanitises the returned value", async () => {
    const outcome = await runScript("const o = { name: 'a' }; o.self = o; return o", evaluate);
    expect(outcome).toEqual({ ok: true, value: { name: "a", self: "[circular]" } });
  });

  test("reports a thrown error as name: message", async () => {
    const outcome = await runScript("throw new TypeError('nope')", evaluate);
    expect(outcome).toEqual({ ok: false, error: "TypeError: nope" });
  });

  test("reports a syntax error rather than throwing", async () => {
    const outcome = await runScript("return (", evaluate);
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toContain("SyntaxError");
  });

  test("reports a rejected promise", async () => {
    const outcome = await runScript("await Promise.reject(new Error('async boom'))", evaluate);
    expect(outcome).toEqual({ ok: false, error: "Error: async boom" });
  });

  test("rejects empty code without evaluating anything", async () => {
    const outcome = await runScript("   ", evaluate);
    expect(outcome).toEqual({ ok: false, error: "run_script requires a non-empty `code` string." });
  });

  test("rejects code over the character cap", async () => {
    const outcome = await runScript("//".padEnd(MAX_SCRIPT_CHARS + 1, "x"), evaluate);
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toContain(
      "Split it into smaller run_script calls"
    );
  });

  test("truncates an oversized result instead of returning it whole", async () => {
    const outcome = await runScript(`return "x".repeat(${MAX_RESULT_CHARS + 100})`, evaluate);
    expect(outcome).toMatchObject({ ok: true, truncated: true });
    expect((outcome as { valuePreview: string }).valuePreview).toHaveLength(MAX_RESULT_CHARS);
  });
});
