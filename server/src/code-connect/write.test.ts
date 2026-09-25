import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCodeConnect } from "./parse.js";
import { renderMappingFile, writeMapping } from "./write.js";

const rendered = renderMappingFile({
  component: "Button",
  importPath: "../ui/Button",
  url: "https://www.figma.com/design/AbC/DS?node-id=1-2",
  props: ["label", "variant"],
});

describe("renderMappingFile", () => {
  test("imports the Code Connect helper and the component", () => {
    expect(rendered).toContain('import figma from "@figma/code-connect";');
    expect(rendered).toContain('import { Button } from "../ui/Button";');
  });

  test("connects the component to the node URL", () => {
    expect(rendered).toContain(
      'figma.connect(Button, "https://www.figma.com/design/AbC/DS?node-id=1-2"'
    );
  });

  test("stubs each declared prop so the author fills it in", () => {
    expect(rendered).toContain('label: figma.string("label")');
    expect(rendered).toContain('variant: figma.string("variant")');
  });

  test("omits the props block entirely when there are none", () => {
    const bare = renderMappingFile({
      component: "Divider",
      importPath: "./Divider",
      url: "https://www.figma.com/design/AbC/DS?node-id=3-4",
      props: [],
    });
    expect(bare).not.toContain("props:");
  });

  test("imports a dotted component by its root identifier", () => {
    const dotted = renderMappingFile({
      component: "Icons.Search",
      importPath: "./icons",
      url: "https://www.figma.com/design/AbC/DS?node-id=3-4",
      props: [],
    });
    expect(dotted).toContain('import { Icons } from "./icons";');
    expect(dotted).toContain("figma.connect(Icons.Search,");
  });

  test("is valid to re-parse", () => {
    expect(parseCodeConnect(rendered, "Button.figma.tsx").mappings[0]).toMatchObject({
      component: "Button",
      nodeId: "1:2",
      props: ["label", "variant"],
    });
  });
});

describe("writeMapping", () => {
  let root: string;
  const button = {
    component: "Button",
    importPath: "./Button",
    url: "https://www.figma.com/design/AbC/DS?node-id=1-2",
    props: [],
    file: "ui/Button.figma.tsx",
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "cc-write-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("creates the file and its directory", async () => {
    expect(await writeMapping(root, button)).toEqual({
      file: "ui/Button.figma.tsx",
      created: true,
    });
    const written = await readFile(path.join(root, "ui", "Button.figma.tsx"), "utf8");
    expect(parseCodeConnect(written, "ui/Button.figma.tsx").mappings).toHaveLength(1);
  });

  test("extends an existing file and brings the new component's import with it", async () => {
    await writeMapping(root, button);
    const result = await writeMapping(root, {
      ...button,
      component: "IconButton",
      importPath: "./IconButton",
      url: "https://www.figma.com/design/AbC/DS?node-id=5-6",
    });
    expect(result.created).toBe(false);
    const written = await readFile(path.join(root, "ui", "Button.figma.tsx"), "utf8");
    expect(written).toContain('import { IconButton } from "./IconButton";');
    expect(written.match(/@figma\/code-connect/g)).toHaveLength(1);
    const parsed = parseCodeConnect(written, "ui/Button.figma.tsx");
    expect(parsed.errors).toEqual([]);
    expect(parsed.mappings.map((m) => [m.component, m.importPath])).toEqual([
      ["Button", "ui/Button"],
      ["IconButton", "ui/IconButton"],
    ]);
  });

  test("inserts the import after a multi-line import, not inside it", async () => {
    await mkdir(path.join(root, "ui"), { recursive: true });
    await writeFile(
      path.join(root, "ui", "Button.figma.tsx"),
      'import figma from "@figma/code-connect";\nimport {\n  Button,\n  ButtonProps,\n} from "./Button";\n\n' +
        'figma.connect(Button, "https://www.figma.com/design/AbC/DS?node-id=1-2");\n'
    );
    await writeMapping(root, {
      ...button,
      component: "Card",
      importPath: "./Card",
      url: "https://www.figma.com/design/AbC/DS?node-id=5-6",
    });
    const written = await readFile(path.join(root, "ui", "Button.figma.tsx"), "utf8");
    expect(written).toContain('} from "./Button";\nimport { Card } from "./Card";');
  });

  test("refuses a node that is already mapped anywhere in the workspace", async () => {
    await writeMapping(root, button);
    await expect(
      writeMapping(root, {
        ...button,
        url: "https://figma.com/design/AbC/Other-Name?node-id=1:2",
        file: "elsewhere/Dup.figma.tsx",
      })
    ).rejects.toThrow(/already mapped.*ui\/Button\.figma\.tsx/);
  });

  test("refuses a path outside the workspace and writes nothing", async () => {
    await expect(writeMapping(root, { ...button, file: "../escape.figma.tsx" })).rejects.toThrow(
      /outside the MCP server working directory/
    );
  });

  test("refuses a non-JSX extension, since the example is JSX", async () => {
    await expect(writeMapping(root, { ...button, file: "ui/Button.figma.ts" })).rejects.toThrow(
      /\.figma\.tsx/
    );
  });

  test("refuses a file whose existing calls it cannot read", async () => {
    await mkdir(path.join(root, "ui"), { recursive: true });
    await writeFile(path.join(root, "ui", "Button.figma.tsx"), "figma.connect(X, notAUrl);");
    await expect(
      writeMapping(root, { ...button, url: "https://www.figma.com/design/AbC/DS?node-id=7-8" })
    ).rejects.toThrow(/could not read/);
  });
});

describe("writeMapping imports", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "cc-imports-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("does not import a component the file already imports", async () => {
    const base = {
      component: "Icons.Search",
      importPath: "./icons",
      url: "https://www.figma.com/design/AbC/DS?node-id=1-2",
      props: [],
      file: "Icons.figma.tsx",
    };
    await writeMapping(root, base);
    await writeMapping(root, {
      ...base,
      component: "Icons.Close",
      url: "https://www.figma.com/design/AbC/DS?node-id=3-4",
    });
    const written = await readFile(path.join(root, "Icons.figma.tsx"), "utf8");
    expect(written.match(/import \{ Icons \}/g)).toHaveLength(1);
  });
});

describe("writeMapping links", () => {
  // A cloned repo can hold a link to a file that does not exist yet. Reading
  // it fails, so it looks new — and a plain write would follow it out.
  test("refuses a dangling link as the target and writes nothing outside", async () => {
    const { symlink, stat } = await import("node:fs/promises");
    const root = await mkdtemp(path.join(tmpdir(), "cc-link-"));
    const outside = await mkdtemp(path.join(tmpdir(), "cc-link-out-"));
    const escaped = path.join(outside, "Escaped.figma.tsx");
    try {
      try {
        await symlink(escaped, path.join(root, "Button.figma.tsx"));
      } catch {
        return; // Symlink creation needs a privilege Windows does not grant by default.
      }
      await expect(
        writeMapping(root, {
          component: "Button",
          importPath: "./Button",
          url: "https://www.figma.com/design/AbC/DS?node-id=1-2",
          props: [],
          file: "Button.figma.tsx",
        })
      ).rejects.toThrow(/link/);
      await expect(stat(escaped)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
