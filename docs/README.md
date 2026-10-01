# Documentation

| Folder                         | For                              | What is in it                                                                        |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------ |
| [`guides/`](guides/)           | anyone driving the relay         | one guide per tool family: contract, limits and gotchas                              |
| [`reference/`](reference/)     | anyone reading tool output       | exact shapes the relay emits, field by field                                         |
| [`superpowers/`](superpowers/) | contributors and executor agents | specs and implementation plans — the design history ([index](superpowers/README.md)) |

## Guides

- [`run-script.md`](guides/run-script.md) — `run_script`, the Plugin API escape hatch: contract, limits, why it is not atomic.
- [`design-context.md`](guides/design-context.md) — `get_design_context`: reference code, tokens, exported assets and the screenshot.
- [`code-connect.md`](guides/code-connect.md) — local Code Connect: reading, suggesting and writing `*.figma.tsx` mappings.
- [`libraries.md`](guides/libraries.md) — `whoami`, `get_libraries`, `import_library_asset`, `search_design_system`, and the permissions and plans they need.
- [`figjam.md`](guides/figjam.md) — FigJam reads and writes, and `generate_diagram`'s Mermaid subset.
- [`slides.md`](guides/slides.md) — what the relay can and cannot do in a Slides deck.

## Reference

- [`serialized-nodes.md`](reference/serialized-nodes.md) — the serialized node shape, and for every field when it is omitted.
- [`2026-10-01-upstream-sync-live-check.md`](reference/2026-10-01-upstream-sync-live-check.md) — the 0.7.6 upstream sync's live Figma evidence and tested build.
- [`2026-10-01-dev-name-port-live-check.md`](reference/2026-10-01-dev-name-port-live-check.md) — 0.7.7's live Figma evidence that Dev plugin names carry their port.
- [`2026-10-01-project-review.md`](reference/2026-10-01-project-review.md) — 0.7.8's cleanup review, automated and live verification, and remaining findings.

Contributor workflow — building, testing, releasing, verifying against a live file — is in
[`.claude/CLAUDE.md`](../.claude/CLAUDE.md) and the rules and skills beside it.
