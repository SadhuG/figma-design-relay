# Spec: Searching the design system across every open file

**Status:** Delivered in 0.7.5 by
[`../plans/2026-09-27-cross-file-design-search.md`](../plans/2026-09-27-cross-file-design-search.md).
The live check (X10) passed on 2026-09-27.
**Date:** 2026-09-27
**Closes:** the last gap in R40 of the
[parity spec](2026-09-01-official-figma-mcp-parity.md) — "components present or instantiated in
the connected files". 0.7.2 made one file searchable on every page (`allPages`); this spec makes one
search cover several files.

---

## In plain words

A designer usually has more than one Figma file open: the **design system file** where components
are built (say _Acme Design System_), and one or more **screen files** that use them (_Checkout
Screens_, _Onboarding Screens_). Today, when the AI searches for "button", it can look in only one of
those files, and when several are open it is told to pick one first.

After this change:

- **One search covers every open design file**, unless the AI names the files it wants. It can read
  the open files' names and pass only the relevant ones ("search Acme Design System"), so it never
  does more work than the question needs.
- **Each component appears once**, however many files it shows up in.
- **The original wins.** If an open file is where the component was built, the answer points
  there, because that is where its variants and settings live. Every other file it appears in is
  listed as "also in", which doubles as a where-is-this-used inventory.
- **FigJam boards and Slides decks are skipped**, and the answer says so.
- **One broken or slow file does not break the search.** It is listed as skipped, with the reason
  and what to do; the other files still answer.

An example answer, three files open, searching "button":

> **Button**: the original is in **Acme Design System**; also in **Checkout Screens** and
> **Onboarding Screens**.
> **Promo Button**: only in **Checkout Screens** (a one-off, not from the system).
> **Colors** (library variable collection): available in all three files.
> _Searched:_ Acme Design System, Checkout Screens, Onboarding Screens. _Skipped:_ Q3 Brainstorm
> (a FigJam board).

## Decisions and why

| Decision                                                            | Why                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serve both workflows: point at the original **and** list every file | The user maintains a system and builds from it. Pointing at the original serves design-to-code (the definition is what `get_design_context` and Code Connect need); the file list serves system management (where is this used). Once results are grouped, the list costs little. |
| With several files open and none named, **search all of them**      | Today that call fails with "specify a fileKey", so no working call changes meaning. An opt-in flag would add a round trip, and a weaker agent would pick one file and miss the original.                                                                                          |
| The agent can **narrow by file name**                               | Keeps the default cheap: the agent reads `list_files` names and passes only the relevant files. Names, not only fileKeys, because the fileKey is usually an `unsaved-…` session key that means nothing to an agent reasoning about "the design system file".                      |
| The **server** fans out and merges; plugin and bridge are untouched | Reuses the per-file request that already works and has been checked live. A bridge-level broadcast would change the path all 53 tools share, for no visible gain. Leaving the merge to the agent would make "one entry, original first" depend on every agent getting it right.   |
| Skip FigJam and Slides                                              | They do not hold design-system components; searching them only adds latency.                                                                                                                                                                                                      |
| Partial failure is a result, not an error                           | A search over five files where one plugin was hot-reloaded should still return four files' worth of answers, and say how to recover the fifth.                                                                                                                                    |
| `allPages` stays opt-in, per call                                   | Every page of every file multiplies the slowest case. The agent turns it on when a current-page search came back short, as today.                                                                                                                                                 |

## Requirements

- **X1. Default scope.** When `search_design_system` is called without `fileKey` or `files`, it
  searches every connected file whose `editorType` is `figma` or `dev` (Dev Mode is a design file).
  A file with no reported `editorType` (an older plugin build) is searched. `figjam` and `slides` files are skipped and
  reported under `files.skipped` with the reason.
- **X2. Narrowing by name.** A new optional parameter `files: string[]` (1–20 entries) limits the
  search to the connected files it names. Each entry matches a connected file by exact fileKey, or
  by file name compared case-insensitively after trimming. The selected files keep connected-file
  order, whatever order `files` names them in, so X5's choice of original does not depend on it. An entry matching several files (two
  files named "Untitled") selects all of them. An entry that matches nothing is reported under
  `files.skipped` as not open, with the list of open file names, and does not fail the call. A named
  FigJam board or Slides deck is skipped as in X1.
- **X3. `fileKey` stays.** `fileKey` keeps working and means "exactly this one file". Passing both
  `fileKey` and `files` is a validation error that says to pass one. Behaviour for a single
  connected file is unchanged except for the added fields in X5 and X6, and X5's tie-break, which
  lists originals before library copies among equal scores. The refusal is raised by the tool
  handler (`search/index.ts`), not the schema, since `files` never crosses the follower hop; its
  test lives in `search/index.test.ts`.
- **X4. Fan-out.** The server sends the existing per-file `search_design_system` request —
  `{ query, limit, allPages }` — to every selected file concurrently, through `node.sendWithParams`
  with that file's fileKey, so it works from the leader and from followers alike. The plugin
  receives exactly what it receives today.
- **X5. Merged hits.** Results from all files are merged by these rules, in order:
  1. Hits with a `key` are grouped by `kind` and `key`. Hits without a key are never merged.
  2. In a group, the **primary** is the first hit (in connected-file order) that is not `remote` —
     the original. If every hit in the group is `remote`, the primary is the first one.
  3. The primary is returned with `fileKey` and `fileName` added. Every other hit in the group
     becomes an entry `{ fileKey, fileName, id }` in the primary's `alsoIn` array, omitted when
     empty.
  4. Variable collections follow the same rules. Their hits carry no `remote` flag, so rule 2 makes
     the first file's hit the primary and `alsoIn` lists the rest.
  5. Merged hits are ordered by `score` descending, then originals before remote copies, then
     name. `limit` (default 50) caps the merged list; `total` is present when the cap cut it.
     Passing the caller's `limit` to each file loses nothing: a hit's score depends only on its
     name, so the merged top N is inside the union of each file's top N, up to ties at the cut
     (the merge puts originals first among equal scores; a file cuts by score and name only).
     A file that cut its own list reports its `total`: one file's is passed through exactly;
     across several, the largest is a lower bound and the note says "at least".
- **X6. Result shape.** The response keeps every field it has today (`results`, `searched`,
  `total`, `libraryError`, `note`) and adds:
  - `files: { searched: Array<{ fileKey, fileName }>, skipped: Array<{ fileKey?, fileName, reason }> }`
  - `instanceErrors?: Array<{ fileName, message }>`, replacing the single-file `instanceError` when
    more than one file was searched. A single-file search keeps `instanceError` as today.

  `searched` stays the list of scopes (pages, collections) and is the same in every file.
  `libraryError` is reported once: library access is per account, not per file.

- **X7. Partial failure.** A file whose request rejects or returns an error (disconnect, the 180 s
  bridge timeout, a plugin error) is listed under `files.skipped` with the error and the recovery
  step — for a disconnect or timeout, "run the plugin in that file again". The call fails only when
  **no** file answered, with an error that names each file's reason; with nothing connected, the
  existing "No plugin connected" error stands.
- **X8. Tool description.** The first sentence still states the relay is much narrower than
  Figma's own search (R40). The description then says: every open design file is searched unless
  `files` names some; when many files are open, read their names with `list_files` and pass only
  the relevant ones; one entry per component, pointing at the original, with `alsoIn` for the rest.
- **X9. Tests.** The merge is a pure function in its own module, unit-tested with stubbed per-file
  results: grouping; original-wins; all-remote fallback; unkeyed hits kept apart; collections once;
  ordering and cap with `total`; every `files.skipped` reason (failed, timed out, not open, FigJam,
  Slides); all-files-failed error; name matching (case, trimming, duplicate names, fileKey). Schema
  tests cover `files` bounds and the `fileKey` + `files` refusal. The file selection (X1–X3) is a
  pure function too, tested the same way.
- **X10. Live check.** Before release, with a design-system file and a screen file that uses it
  both running the plugin: a search for a shared component returns one hit whose `fileName` is the
  design-system file, with the screen file under `alsoIn`. Then close the plugin in one file and
  confirm the search still answers and lists that file under `files.skipped`. A closed file is
  listed there only when `files` names it: a search with no `files` cannot know a file whose plugin
  is closed was ever open, so it simply searches the rest.

## Where it lives

| Piece                         | Place                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| File selection (X1–X3)        | `server/src/search/select-files.ts`, pure: connected files + `files` → selected and skipped       |
| Merge (X5–X7)                 | `server/src/search/merge.ts`, pure: per-file settled results → one response                       |
| Fan-out and wiring (X4)       | the `search_design_system` handler in `server/src/tools.ts`                                       |
| Connected-file lookup         | the leader/follower branch already inside the `list_files` handler, lifted into a helper both use |
| Schema (`files`, the refusal) | `server/src/schema.ts`                                                                            |
| Plugin                        | no change                                                                                         |

## Out of scope

- **Searching files that are not open.** The Plugin API cannot reach them; an organisation-wide
  library search remains impossible, and the note keeps saying an empty result is not proof of
  absence.
- **Other tools going multi-file.** Only search fans out. Every other tool still needs one file.
- **Caching results between searches.** Files change while open; a stale "also in" list is worse
  than a slightly slower search.

## Docs to update with the change

`docs/guides/libraries.md` (what search covers, the result fields, partial failure), the tool
description, README's tool table and library note, the R40 row in `docs/superpowers/README.md`
(delivered), the parity spec's status line, and `CHANGELOG.md`.
