import type { Stats } from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { MAX_SVG_BYTES } from "./schema.js";
import { isInsideWorkspace } from "./workspace-path.js";

/**
 * create_svg's source loader. Inline markup passes through; a file path is read
 * only from inside the MCP server's working directory, through one descriptor,
 * and never past the byte cap. This is a preflight for clear errors, not an XML
 * sanitizer: Figma's `createNodeFromSvg` is the parser. URLs are never fetched.
 */

/** The file handle calls the loader makes, so tests can stand in for a file. */
export interface SvgFileHandle {
  stat(): Promise<Stats>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/** The filesystem calls the loader makes; the default is node:fs/promises. */
export interface SvgFs {
  realpath(target: string): Promise<string>;
  stat(target: string): Promise<Stats>;
  open(target: string): Promise<SvgFileHandle>;
}

const nodeFs: SvgFs = {
  realpath: (target) => fsPromises.realpath(target),
  stat: (target) => fsPromises.stat(target),
  open: (target) => fsPromises.open(target, "r"),
};

const SVG_PROLOG_TOKENS: ReadonlyArray<readonly [open: string, close: string]> = [
  ["<?xml", "?>"],
  ["<!--", "-->"],
];

/** End of the DOCTYPE, ignoring delimiters inside quoted values, comments and subsets. */
function doctypeEnd(source: string): number {
  let quote = "";
  let depth = 0;
  for (let i = "<!DOCTYPE".length; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end === -1) return -1;
      i = end + 2;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      if (depth === 0) return -1;
      depth--;
    } else if (char === ">" && depth === 0) {
      return i + 1;
    }
  }
  return -1;
}

const tooLarge = () =>
  new Error(
    `SVG source exceeds the ${MAX_SVG_BYTES} byte bridge limit. Simplify or split the SVG and retry.`
  );

const outside = (root: string) =>
  new Error(
    `SVG source must be inside the MCP server working directory (${root}). Copy the file into the workspace and pass a path relative to it.`
  );

function stripLeadingBomAndWhitespace(source: string): string {
  return source.replace(/^﻿/, "").trimStart();
}

/** File paths never start with `<`, so anything that does is treated as inline markup. */
function isInlineMarkup(source: string): boolean {
  return stripLeadingBomAndWhitespace(source).startsWith("<");
}

/** A URL or data URI, which the loader refuses rather than fetching. */
function isRemote(source: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|data:)/i.test(source.trim());
}

/**
 * Checks whether text has an `<svg>` root after the XML prolog vector editors
 * emit: an optional BOM, XML declaration, comments, and DOCTYPE. This is a
 * cheap pre-check for a clear error; Figma performs the full parse.
 */
function hasSvgRoot(source: string): boolean {
  let rest = stripLeadingBomAndWhitespace(source);
  for (;;) {
    if (rest.startsWith("<!DOCTYPE")) {
      const end = doctypeEnd(rest);
      if (end === -1) return false;
      rest = rest.slice(end).trimStart();
      continue;
    }
    const token = SVG_PROLOG_TOKENS.find(([open]) => rest.startsWith(open));
    if (!token) break;
    const [open, close] = token;
    const end = rest.indexOf(close, open.length);
    if (end === -1) return false;
    rest = rest.slice(end + close.length).trimStart();
  }
  return /^<svg[\s/>]/.test(rest);
}

/**
 * Compares filesystem identities rather than path strings. Node exposes the
 * device and inode/file-index values through Stats on both POSIX and Windows.
 */
function isSameFile(opened: Stats, current: Stats): boolean {
  return opened.dev === current.dev && opened.ino === current.ino;
}

/**
 * Reads at most `limit` bytes. A file that grows after its size was checked
 * cannot make the read unbounded: the buffer is the limit.
 */
export async function readAtMost(
  file: Pick<SvgFileHandle, "read">,
  limit: number
): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit);
  let filled = 0;
  while (filled < limit) {
    const { bytesRead } = await file.read(buffer, filled, limit - filled, null);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

async function readSvgFile(source: string, workspaceRoot: string, fs: SvgFs): Promise<string> {
  const resolvedRoot = await fs.realpath(path.resolve(workspaceRoot));
  const lexicalPath = path.resolve(resolvedRoot, source);
  if (!isInsideWorkspace(resolvedRoot, lexicalPath)) throw outside(resolvedRoot);

  let resolvedPath: string;
  try {
    resolvedPath = await fs.realpath(lexicalPath);
  } catch {
    throw new Error(
      `SVG source not found: ${source}. Pass a path relative to the MCP server working directory, or the SVG markup itself.`
    );
  }
  // Links are resolved first, so a workspace link cannot point the read outside.
  if (!isInsideWorkspace(resolvedRoot, resolvedPath)) throw outside(resolvedRoot);

  let file: SvgFileHandle;
  try {
    file = await fs.open(resolvedPath);
  } catch {
    throw new Error(`SVG source is not a readable regular file: ${source}`);
  }
  try {
    const openedInfo = await file.stat();
    if (!openedInfo.isFile()) {
      throw new Error(`SVG source is not a readable regular file: ${source}`);
    }
    if (openedInfo.size > MAX_SVG_BYTES) throw tooLarge();

    // Re-resolve after opening and compare identities: a link or directory
    // swapped in between the checks and the open is caught before any read,
    // without platform-specific openat bindings Node does not expose.
    let currentPath: string;
    try {
      currentPath = await fs.realpath(lexicalPath);
    } catch {
      throw new Error(`SVG source changed while it was being opened: ${source}`);
    }
    if (!isInsideWorkspace(resolvedRoot, currentPath)) throw outside(resolvedRoot);
    if (!isSameFile(openedInfo, await fs.stat(currentPath))) {
      throw new Error(`SVG source changed while it was being opened: ${source}`);
    }

    const bytes = await readAtMost(file, MAX_SVG_BYTES + 1);
    if (bytes.length > MAX_SVG_BYTES) throw tooLarge();
    return new TextDecoder("utf-8").decode(bytes);
  } finally {
    await file.close();
  }
}

/**
 * Resolves inline SVG markup or reads a workspace-contained SVG file, and checks
 * its size and document root before it is forwarded to Figma.
 * @param source - SVG markup, or a file path relative to `workspaceRoot`.
 * @param workspaceRoot - The MCP server's working directory.
 * @param fs - Filesystem calls; tests replace them.
 */
export async function loadSvgSource(
  source: string,
  workspaceRoot: string,
  fs: SvgFs = nodeFs
): Promise<string> {
  let svgText: string;
  if (isInlineMarkup(source)) {
    svgText = source;
  } else if (isRemote(source)) {
    throw new Error(
      "create_svg takes SVG markup or a workspace file path; URLs and data URIs are not fetched. Save the SVG inside the MCP server working directory, or pass its markup."
    );
  } else {
    svgText = await readSvgFile(source, workspaceRoot, fs);
  }

  if (Buffer.byteLength(svgText, "utf8") > MAX_SVG_BYTES) throw tooLarge();
  if (!hasSvgRoot(svgText)) {
    throw new Error(
      "SVG source must begin with an <svg> element (after an optional XML declaration, comments or DOCTYPE)."
    );
  }
  return svgText;
}
