import { describe, expect, test } from "bun:test";
import { parseCodeConnect } from "./parse.js";

const source = `
import figma from "@figma/code-connect";
import { Button } from "./Button";
import * as Icons from "@acme/icons";

// figma.connect(Ignored, "https://figma.com/design/K/D?node-id=9-9")
figma.connect(Button, "https://www.figma.com/design/AbC/DS?node-id=1-2", {
  props: {
    label: figma.string("Label"),
    variant: figma.enum("Variant", { Primary: "primary" }),
  },
  example: (props) => <Button {...props} />,
});

figma.connect(Icons.Search, "https://www.figma.com/design/AbC/DS?node-id=3-4");
`;

describe("parseCodeConnect", () => {
  test("finds every call", () => {
    expect(parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings).toHaveLength(2);
  });

  test("records the component, the target and the source path", () => {
    const [first] = parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings;
    expect(first).toMatchObject({
      component: "Button",
      fileKey: "AbC",
      nodeId: "1:2",
      source: "src/ui/Button.figma.tsx",
    });
  });

  test("lists the declared props", () => {
    const [first] = parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings;
    expect(first.props).toEqual(["label", "variant"]);
  });

  test("handles a dotted component name and a missing options object", () => {
    const [, second] = parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings;
    expect(second.component).toBe("Icons.Search");
    expect(second.props).toEqual([]);
  });

  test("resolves a relative import to a workspace-relative path", () => {
    const [first] = parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings;
    expect(first.importPath).toBe("src/ui/Button");
  });

  test("keeps a package import as written, matched by the root identifier", () => {
    const [, second] = parseCodeConnect(source, "src/ui/Button.figma.tsx").mappings;
    expect(second.importPath).toBe("@acme/icons");
  });

  test("leaves the import path unset when the component is not imported", () => {
    const result = parseCodeConnect(
      'figma.connect(Local, "https://figma.com/design/K/D?node-id=1-2");',
      "x.figma.ts"
    );
    expect(result.mappings[0].importPath).toBeUndefined();
  });

  test("ignores calls inside comments", () => {
    const components = parseCodeConnect(source, "x.figma.ts").mappings.map((m) => m.component);
    expect(components).not.toContain("Ignored");
  });

  test("reports a call it cannot read instead of dropping it", () => {
    const result = parseCodeConnect("figma.connect(Button, someUrlVariable);", "bad.figma.ts");
    expect(result.mappings).toHaveLength(0);
    expect(result.errors[0]).toContain("bad.figma.ts");
  });

  test("reports an unterminated call", () => {
    const result = parseCodeConnect(
      'figma.connect(Button, "https://figma.com/design/K/D?node-id=1-2"',
      "trunc.figma.ts"
    );
    expect(result.errors[0]).toContain("trunc.figma.ts");
  });

  test("says the rest of the file was not read after an unterminated call", () => {
    const result = parseCodeConnect(
      `figma.connect(A, "https://figma.com/design/K/D?node-id=1-2", { example: () => <p>Don't</p> });
figma.connect(B, "https://figma.com/design/K/D?node-id=3-4");`,
      "apostrophe.figma.tsx"
    );
    expect(result.errors[0]).toMatch(/rest of the file/);
  });
});

describe("parseCodeConnect import paths", () => {
  test("does not take a longer name that shares the prefix", () => {
    const [mapping] = parseCodeConnect(
      'import { ButtonGroup } from "./group";\nimport { Button } from "./button";\n' +
        'figma.connect(Button, "https://figma.com/design/K/D?node-id=1-2");',
      "ui/Button.figma.tsx"
    ).mappings;
    expect(mapping.importPath).toBe("ui/button");
  });
});
