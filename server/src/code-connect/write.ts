import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCodeConnectIndex } from "./index.js";
import { parseCodeConnect } from "./parse.js";
import { parseFigmaUrl } from "./url.js";

export interface MappingInput {
  /** The component as referenced in code, e.g. `Button` or `Icons.Search`. */
  component: string;
  /** Import specifier for the component, relative to the mapping file. */
  importPath: string;
  url: string;
  props: string[];
}

/** `Icons.Search` is imported as `Icons`. */
const importName = (component: string): string => component.split(".")[0];

const importLine = (input: MappingInput): string =>
  `import { ${importName(input.component)} } from "${input.importPath}";`;

/** The `figma.connect(...)` call alone, without imports. */
const renderCall = (input: MappingInput): string => {
  const props =
    input.props.length > 0
      ? `  props: {\n${input.props.map((prop) => `    ${prop}: figma.string("${prop}"),`).join("\n")}\n  },\n`
      : "";
  return `figma.connect(${input.component}, "${input.url}", {
${props}  example: (props) => <${input.component} {...props} />,
});
`;
};

/**
 * Renders a Code Connect file for one mapping.
 *
 * Props are stubbed as `figma.string(...)` rather than guessed: the author
 * knows whether a prop is a boolean, an enum or a nested instance, and a wrong
 * guess is harder to spot than an obvious placeholder.
 */
export const renderMappingFile = (input: MappingInput): string =>
  `import figma from "@figma/code-connect";\n${importLine(input)}\n\n${renderCall(input)}`;

/**
 * Real path of the nearest ancestor of `target` that already exists — the
 * directory `mkdir -p` would start creating from.
 */
const realpathOfExistingAncestor = async (target: string): Promise<string> => {
  let current = target;
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
};

/**
 * Writes a mapping file inside the workspace, or appends the mapping to one.
 *
 * @param root - The MCP server's working directory.
 * @param input - The mapping, plus the target path relative to `root`.
 * @returns The workspace-relative path written, and whether the file is new.
 * @throws When the target resolves outside the working directory, is not a
 * `.figma.tsx`/`.figma.jsx` file, when the node is already mapped anywhere in
 * the workspace (two mappings for one node make the answer ambiguous), or when
 * the target holds a call the parser cannot read (the duplicate check would be
 * blind to it).
 */
export const writeMapping = async (
  root: string,
  input: MappingInput & { file: string }
): Promise<{ file: string; created: boolean }> => {
  if (!/\.figma\.(tsx|jsx)$/.test(input.file)) {
    throw new Error(
      `file "${input.file}" must end in .figma.tsx or .figma.jsx — the mapping's example is JSX.`
    );
  }

  const base = await realpath(root);
  const inside = (candidate: string): boolean =>
    candidate === base || candidate.startsWith(base + path.sep);
  const escapes = (): never => {
    throw new Error(
      `file "${input.file}" resolves outside the MCP server working directory (${base}). ` +
        `Code Connect mappings must live in the workspace so they can be committed.`
    );
  };

  // Lexical check for `../x`, then the deepest existing ancestor for a link
  // inside the workspace that points out — before anything is created.
  const target = path.resolve(base, input.file);
  if (!inside(target)) escapes();
  if (!inside(await realpathOfExistingAncestor(target))) escapes();
  const relative = path.relative(base, target).split(path.sep).join("/");

  const wanted = parseFigmaUrl(input.url);
  if (!wanted) throw new Error(`"${input.url}" is not a Figma node URL.`);
  const index = await buildCodeConnectIndex(base);
  const existingMapping = index.lookup(wanted.nodeId, wanted.fileKey);
  if (existingMapping) {
    throw new Error(
      `Node ${wanted.nodeId} is already mapped to ${existingMapping.component} in ${existingMapping.source}. ` +
        `Edit that figma.connect call rather than adding a second one.`
    );
  }

  let existing: string | null = null;
  try {
    existing = await readFile(target, "utf8");
  } catch {
    existing = null;
  }

  if (existing === null) {
    await mkdir(path.dirname(target), { recursive: true });
    if (!inside(await realpath(path.dirname(target)))) escapes();
    await writeFile(target, renderMappingFile(input));
    return { file: relative, created: true };
  }

  if (!inside(await realpath(target))) escapes();
  const parsed = parseCodeConnect(existing, relative);
  if (parsed.errors.length > 0) {
    throw new Error(
      `${relative} has figma.connect calls this server could not read, so a duplicate could go unnoticed. ` +
        `Fix them first:\n${parsed.errors.join("\n")}`
    );
  }

  // The component must be imported for the appended call to compile.
  let next = existing.trimEnd();
  const name = importName(input.component);
  const alreadyImported = new RegExp(`\bimport\s[^;]*\b${name}\b[^;]*\sfrom\s`).test(next);
  if (!alreadyImported) {
    // After the end of the last import statement, which may span lines.
    let end = 0;
    for (const match of next.matchAll(/^import\s[^;]*?from\s+["'][^"']+["'];?/gm)) {
      end = match.index + match[0].length;
    }
    next =
      end === 0
        ? `${importLine(input)}\n${next}`
        : `${next.slice(0, end)}\n${importLine(input)}${next.slice(end)}`;
  }

  await writeFile(target, `${next}\n\n${renderCall(input)}`);
  return { file: relative, created: false };
};
