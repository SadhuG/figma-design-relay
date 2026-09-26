import { describe, expect, test } from "bun:test";
import card from "./fixtures/card.json" with { type: "json" };
import { cssVarName, toReact } from "./react.js";
import type { SerializedNode } from "./tokens.js";

const output = toReact(card as unknown as SerializedNode);

describe("cssVarName", () => {
  test("turns a token path into a CSS custom property", () => {
    expect(cssVarName("color/brand/primary")).toBe("--color-brand-primary");
  });

  test("collapses spaces and casing", () => {
    expect(cssVarName("Heading/M Bold")).toBe("--heading-m-bold");
  });
});

describe("toReact", () => {
  test("emits auto-layout as flex with the real gap and padding", () => {
    expect(output).toContain("flex flex-col");
    expect(output).toContain("gap-[12px]");
    expect(output).toContain("p-[16px]");
  });

  test("uses the token, never the hex, for a bound fill", () => {
    expect(output).toContain("var(--color-surface)");
    expect(output).not.toContain("#101820");
  });

  test("falls back to the raw colour where nothing is bound", () => {
    expect(output).toContain("#FFFFFF");
  });

  test("names the Figma component instead of inventing one", () => {
    expect(output).toContain("{/* Figma component: Button/Primary — map with Code Connect */}");
  });

  test("renders text content", () => {
    expect(output).toContain("Monthly report");
  });

  test("is stable across runs", () => {
    expect(toReact(card as unknown as SerializedNode)).toBe(output);
  });
});

describe("toReact text escaping", () => {
  // Reference code goes into a JSX or HTML file: braces and angle brackets in
  // design copy would otherwise produce code that does not parse.
  test("escapes JSX-significant characters in text content", () => {
    const out = toReact({
      id: "2:1",
      name: "Copy",
      type: "TEXT",
      characters: "Total < 100 & {user}",
    } as unknown as SerializedNode);
    expect(out).toContain("Total &lt; 100 &amp; &#123;user&#125;");
    expect(out).not.toContain("{user}");
  });
});

describe("toReact instances", () => {
  // The placeholder must not invent a codebase component, but hiding the
  // instance's content would hide the button label the agent has to render.
  test("renders an instance's children inside the placeholder", () => {
    const out = toReact({
      id: "4:1",
      name: "Confirm",
      type: "INSTANCE",
      design: { mainComponent: { id: "9:1", key: "btn", name: "Button/Primary" } },
      children: [{ id: "4:2", name: "Label", type: "TEXT", characters: "Save changes" }],
    } as unknown as SerializedNode);
    expect(out).toContain("Figma component: Button/Primary");
    expect(out).toContain("Save changes");
  });

  // R25: a Code Connect mapping outranks every other hint, and the output says
  // which source it used so a mapped component reads differently from a guess.
  test("renders a mapped instance as the mapped component and names the mapping", () => {
    const out = toReact(
      {
        id: "4:1",
        name: "Confirm",
        type: "INSTANCE",
        design: { mainComponent: { id: "9:1", key: "btn", name: "Button/Primary" } },
        children: [{ id: "4:2", name: "Label", type: "TEXT", characters: "Save changes" }],
      } as unknown as SerializedNode,
      { mappings: { "4:1": { component: "Button", source: "src/ui/Button.figma.tsx" } } }
    );
    expect(out).toContain("{/* Code Connect: Button — src/ui/Button.figma.tsx */}");
    expect(out).toContain('<Button data-figma-node="4:1">');
    expect(out).toContain("Save changes");
    expect(out).toContain("</Button>");
    expect(out).not.toContain("map with Code Connect");
  });
});

// R25: Code Connect → component description → annotation → token → raw value,
// each line naming its source so the agent can weigh it.
describe("toReact hint priority", () => {
  const annotated = {
    id: "6:1",
    name: "Delete",
    type: "INSTANCE",
    annotations: [
      { label: "Confirm before deleting", properties: ["fills"] },
      { properties: ["cornerRadius"] },
    ],
    design: {
      mainComponent: {
        id: "9:1",
        key: "btn",
        name: "Button/Danger",
        description: "Destructive action.\nOne per view.",
      },
    },
  } as unknown as SerializedNode;

  test("emits the component description, then annotations, below the component line", () => {
    const lines = toReact(annotated).split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "{/* Figma component: Button/Danger — map with Code Connect */}",
      "{/* component description: Destructive action. One per view. */}",
      "{/* annotation: Confirm before deleting [fills] */}",
      "{/* annotation: [cornerRadius] */}",
    ]);
  });

  test("keeps both below a Code Connect mapping, which still ranks first", () => {
    const lines = toReact(annotated, {
      mappings: { "6:1": { component: "DangerButton", source: "src/DangerButton.figma.tsx" } },
    }).split("\n");
    expect(lines[0]).toBe("{/* Code Connect: DangerButton — src/DangerButton.figma.tsx */}");
    expect(lines[1]).toContain("component description:");
    expect(lines[2]).toContain("annotation: Confirm before deleting");
  });

  test("annotates plain frames and text, with an annotation above the text style", () => {
    const out = toReact({
      id: "6:2",
      name: "Row",
      type: "FRAME",
      annotations: [{ label: "Sticky on scroll" }],
      children: [
        {
          id: "6:3",
          name: "Title",
          type: "TEXT",
          characters: "Hi",
          annotations: [{ label: "Truncate at one line" }],
          design: { styles: { text: { id: "S:1", name: "Heading/M" } } },
        },
      ],
    } as unknown as SerializedNode);
    expect(out.split("\n")).toEqual([
      "{/* annotation: Sticky on scroll */}",
      "<div>",
      "  {/* annotation: Truncate at one line */}",
      "  {/* text style: Heading/M */}",
      "  <span>Hi</span>",
      "</div>",
    ]);
  });

  // Designer copy lands inside a comment: a stray `*/` would end it early and
  // leave the rest as code, and `-->` would do the same in the HTML format.
  test("cannot close its own comment early", () => {
    const out = toReact({
      id: "6:4",
      name: "Box",
      type: "FRAME",
      annotations: [{ label: "a */ b --> c" }],
    } as unknown as SerializedNode);
    expect(out).toContain("{/* annotation: a * / b -- > c */}");
  });
});

describe("toReact real-data hygiene", () => {
  test("names the component set for a variant instance", () => {
    const out = toReact({
      id: "5:1",
      name: "Sign up",
      type: "INSTANCE",
      design: {
        mainComponent: { id: "9:1", key: "k", name: "Size=lg, Type=Secondary", setName: "Button" },
      },
    } as unknown as SerializedNode);
    expect(out).toContain("Figma component: Button (Size=lg, Type=Secondary)");
  });

  // Figma stores geometry as floats; 13.333333969116211px is noise, not intent.
  test("rounds pixel values to two decimals", () => {
    const out = toReact({
      id: "5:2",
      name: "Row",
      type: "FRAME",
      styles: {
        autoLayout: { direction: "HORIZONTAL", gap: 13.333333969116211 },
        padding: { top: 12, right: 28.000001, bottom: 12, left: 28.000001 },
        cornerRadius: 5.333333492279053,
      },
    } as unknown as SerializedNode);
    expect(out).toContain("gap-[13.33px]");
    expect(out).toContain("pr-[28px]");
    expect(out).toContain("rounded-[5.33px]");
    expect(out).not.toContain("13.333333");
  });

  // An exported icon is a file; rendering its paths as coloured divs is
  // exactly the hand-drawn markup the asset contract tells the agent to avoid.
  test("renders an exported node as an image reference instead of its paths", () => {
    const out = toReact(
      {
        id: "5:3",
        name: "Button",
        type: "FRAME",
        children: [
          {
            id: "5:4",
            name: "google-logo-color",
            type: "INSTANCE",
            design: { mainComponent: { id: "9:2", key: "g", name: "google-logo-color" } },
            children: [
              {
                id: "5:5",
                name: "Vector",
                type: "VECTOR",
                styles: { fills: [{ type: "SOLID", color: "#ffc107" }] },
              },
            ],
          },
        ],
      } as unknown as SerializedNode,
      { assets: { "5:4": "assets/google-logo-color-5-4.svg" } }
    );
    expect(out).toContain(
      '<img src="assets/google-logo-color-5-4.svg" alt="google-logo-color" data-figma-node="5:4" />'
    );
    expect(out).not.toContain("#ffc107");
    expect(out).not.toContain("Figma component: google-logo-color");
  });
});
