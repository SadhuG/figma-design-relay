// R6 — a script that throws must come back as an MCP error result (probe.mjs
// prints `isError: true`), not a success payload that merely describes a
// failure.
//
// The lookup is the async one on purpose. `documentAccess: "dynamic-page"`
// makes the synchronous `figma.getNodeById` throw on its own, which would prove
// the manifest setting rather than the error path this file is named for.
const missing = await figma.getNodeByIdAsync("0:999999999");
return missing.name; // missing is null — TypeError, thrown from the script body
