# Phase 1: Figma design

Back to [the overview](00-overview.md).

## Goal and scope

Finish the spec in Figma before any code, so every later phase can check itself against it.

- **In:** the `Plugin panel` component set (`97:857`) in section **Theme toggle** (`97:868`), page
  **Plugin UI screens** (`80:96903`).
- **Out:** the other Rising sun screens, which are already final; any code.

## Requirements

- The `Toggle=Body row` variants show what a dev build shows: the Dev app icon
  (`Channel=Dev, State=Live`) and the Dev pill (`Dev: panel-theme`) in place of `v0.7.8`.
- The Theme row's text follows the overview's Override UI decision: Light variant `Light · Figma`,
  Dark variant `Dark · override`. The extra variant pair below covers the other two texts.
- The section also shows the other two texts, `Light · override` and `Dark · Figma`, as a
  caption beside the body-row variants: a text layer in `text/secondary`, Zen Kaku Gothic New 11.
  Adding a third variant property would double the set for a text change, and the prototype only
  needs Light ↔ Dark.
- The `Toggle=Footer` variants stay but are labelled as the option not chosen: rename the prototype
  frame `09a Prototype · toggle in footer (not chosen)`.
- The section label reads `09 Theme override (dev builds only)`.

## Tasks

- [ ] **Step 1:** Run `list_files` and confirm "Figma Design Relay" is connected; if not, stop and
      ask the user.
- [ ] **Step 2:** In both body-row variants, swap the footer's app icon to the Dev / Live variant
      and replace the `v0.7.8` text with an instance or copy of the Dev pill from
      `02 Dev slot · connected` (`80:96988`).
- [ ] **Step 3:** Set the Theme row value texts and add the following/overriding examples.
- [ ] **Step 4:** Rename the section label and the footer prototype frame.
- [ ] **Step 5:** Re-check the body-row panel's content height: it was 145 (rows 4 × 15 + 18,
      footer 36). Note any change in the overview's Window height decision.
- [ ] **Step 6:** Screenshot the section with `save_screenshots` into the worktree's `.shots/`
      (delete it after), check it, and show it to the user.

## Implementation notes

- The relay's `figma.variables.getVariableByIdAsync` and `getMainComponentAsync` timed out on
  2026-10-23 in this file while plain node reads worked. Read variant properties from
  `instance.componentProperties` and resolved colours from paints rather than looking up the
  variables. `swapComponent` needs the target component node: fetch it with `getNodeByIdAsync`.
- Keep every colour bound to the `Rising sun / Roles` (light) or `Rising sun / Roles dark`
  collection, as the existing variants are.

## Dependencies

None.

## Acceptance checks

- The screenshot shows four states of the dev panel with the overview's exact texts, the Dev pill
  and Dev icon.
- Both prototype flows still switch Light ↔ Dark in Present (ask the user to click through; the
  agent can't).
