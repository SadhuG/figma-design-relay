import path from "node:path";
import { parseFigmaUrl } from "./url.js";

export interface Mapping {
  /** The code component's identifier as written, e.g. `Button` or `Icons.Search`. */
  component: string;
  fileKey: string;
  nodeId: string;
  /** Workspace-relative path of the file declaring the mapping. */
  source: string;
  /**
   * Where the component is imported from: a workspace-relative path for a
   * relative import, the specifier as written for a package. Unset when the
   * file does not import it.
   */
  importPath?: string;
  /** Prop names declared in the options object, in source order. */
  props: string[];
}

export interface ParseResult {
  mappings: Mapping[];
  /** One message per call this scanner could not read. Never silent. */
  errors: string[];
}

const OPENERS = "([{";
const CLOSERS = ")]}";

/**
 * Blanks out string and comment contents so a scan sees only code structure.
 * Positions are preserved, so indices into the mask are valid in the original.
 */
const maskLiterals = (source: string): string => {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) ((out[i] = source[i] === "\n" ? "\n" : " "), i++);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (source[i] === quote) break;
        out[i] = source[i] === "\n" ? "\n" : " ";
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
};

/** Returns the index of the bracket matching the one at `open`, or -1. */
const matchBracket = (mask: string, open: number): number => {
  const stack: string[] = [];
  for (let i = open; i < mask.length; i++) {
    const ch = mask[i];
    if (OPENERS.includes(ch)) stack.push(ch);
    else if (CLOSERS.includes(ch)) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
};

/** Splits an argument list on commas that sit at depth zero. */
const splitArgs = (mask: string, from: number, to: number): Array<[number, number]> => {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const ch = mask[i];
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, to]);
  return spans;
};

/** Reads the prop names declared in `props: { ... }` inside the options object. */
const readProps = (source: string, mask: string, from: number, to: number): string[] => {
  const key = mask.slice(from, to).search(/\bprops\s*:/);
  if (key === -1) return [];
  const brace = mask.indexOf("{", from + key);
  if (brace === -1 || brace >= to) return [];
  const close = matchBracket(mask, brace);
  if (close === -1) return [];

  const names: string[] = [];
  let depth = 0;
  let atKey = true;
  let buffer = "";
  for (let i = brace + 1; i < close; i++) {
    const ch = mask[i];
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth--;
    else if (depth === 0 && ch === ":") {
      if (atKey) {
        const name = buffer.trim();
        const quoted = name.match(/^(["'])(.*)\1$/);
        if (quoted) names.push(quoted[2]);
        else if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
        atKey = false;
      }
      buffer = "";
      continue;
    } else if (depth === 0 && ch === ",") {
      atKey = true;
      buffer = "";
      continue;
    }
    if (depth === 0 && atKey) buffer += source[i];
  }
  return names;
};

/** A \`figma.connect(\` or \`figma.connect<Props>(\` call site. */
const callPattern = (): RegExp => /\bfigma\s*\.\s*connect\s*(?:<[^()]*?>\s*)?\(/g;

/**
 * Removes comments without tracking strings \u2014 deliberately naive, so it
 * cannot be confused the way the mask can. \`https://\` survives because a line
 * comment must not follow a colon.
 */
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");

const IMPORT = /\bimport\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;

/** Escapes a string for literal use inside a `RegExp`. */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds where `component` is imported from. `Icons.Search` is matched by its
 * root identifier, `Icons`. Imports inside comments are skipped.
 */
const readImportPath = (
  source: string,
  mask: string,
  component: string,
  sourcePath: string
): string | undefined => {
  const root = component.split(".")[0];
  const named = new RegExp(String.raw`(^|[^\w$])${escapeRegExp(root)}([^\w$]|$)`);
  for (const match of source.matchAll(IMPORT)) {
    if (mask[match.index] !== "i" || !named.test(match[1])) continue;
    const specifier = match[2];
    if (!specifier.startsWith(".")) return specifier;
    return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
  }
  return undefined;
};

/**
 * Extracts every `figma.connect(...)` mapping from one Code Connect file.
 *
 * A call the scanner cannot read is reported in `errors` with its file and
 * line, never dropped — silence would make an agent believe a mapped component
 * is unmapped and generate a fresh one.
 * @param source - The file's contents.
 * @param sourcePath - Workspace-relative path, used in results and errors.
 */
export const parseCodeConnect = (source: string, sourcePath: string): ParseResult => {
  const mask = maskLiterals(source);
  const mappings: Mapping[] = [];
  const errors: string[] = [];

  const CALL = callPattern();
  let match: RegExpExecArray | null;
  let seen = 0;
  let stopped = false;

  while ((match = CALL.exec(mask)) !== null) {
    seen++;
    const open = match.index + match[0].length - 1;
    const line = source.slice(0, match.index).split("\n").length;
    const close = matchBracket(mask, open);
    if (close === -1) {
      // An unbalanced call usually means a stray quote — an apostrophe in JSX
      // text — swallowed the source after it, so later calls are not visible.
      errors.push(
        `${sourcePath}:${line} — unterminated figma.connect(...) call; the rest of the file ` +
          `was not read. An apostrophe in JSX text (Don't) is the usual cause — write it as &apos;.`
      );
      stopped = true;
      break;
    }

    const args = splitArgs(mask, open + 1, close);
    const component = source.slice(args[0]?.[0] ?? 0, args[0]?.[1] ?? 0).trim();
    const urlSpan = args[1];
    const urlMatch = urlSpan
      ? source.slice(urlSpan[0], urlSpan[1]).match(/["'`]([^"'`]+)["'`]/)
      : null;

    if (!component || !urlMatch) {
      errors.push(
        `${sourcePath}:${line} — could not read the component and URL arguments; ` +
          `expected figma.connect(Component, "https://figma.com/design/...?node-id=1-2", { ... })`
      );
      continue;
    }

    const target = parseFigmaUrl(urlMatch[1]);
    if (!target) {
      errors.push(`${sourcePath}:${line} — "${urlMatch[1]}" is not a Figma node URL`);
      continue;
    }

    const mapping: Mapping = {
      component,
      fileKey: target.fileKey,
      nodeId: target.nodeId,
      source: sourcePath,
      props: args[2] ? readProps(source, mask, args[2][0], args[2][1]) : [],
    };
    const importPath = readImportPath(source, mask, component, sourcePath);
    if (importPath) mapping.importPath = importPath;
    mappings.push(mapping);

    CALL.lastIndex = close;
  }

  // The mask can be wrong — a quote inside a regex literal or JSX text opens a
  // phantom string that hides whatever follows. Counting calls again with only
  // comments removed catches what the mask hid, so no call vanishes silently.
  const expected = stripComments(source).match(callPattern())?.length ?? 0;
  if (!stopped && expected > seen) {
    errors.push(
      `${sourcePath} — ${expected - seen} of ${expected} figma.connect calls could not be located and are missing from the mappings. ` +
        `A quote inside a regex literal or JSX text (Don't) usually causes this — write it as &apos; or move the regex out of the file.`
    );
  }

  return { mappings, errors };
};
