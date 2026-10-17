import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_SVG_BYTES, validateRpc } from "./schema.js";
import { loadSvgSource, readAtMost, type SvgFs } from "./svg.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>';

let root: string;
let workspace: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "relay-svg-"));
  workspace = path.join(root, "workspace");
  outside = path.join(root, "outside");
  await mkdir(workspace);
  await mkdir(outside);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** An SVG of exactly `bytes` UTF-8 bytes, padded inside a comment with a multibyte char. */
const svgOfBytes = (bytes: number): string => {
  const head = '<svg xmlns="http://www.w3.org/2000/svg"><!--';
  const tail = "--></svg>";
  const room = bytes - Buffer.byteLength(head + tail);
  // "é" is two bytes in UTF-8, so the multibyte path is exercised too.
  const pairs = Math.floor(room / 2);
  const text = head + "é".repeat(pairs) + "a".repeat(room - pairs * 2) + tail;
  expect(Buffer.byteLength(text)).toBe(bytes);
  return text;
};

describe("inline SVG", () => {
  test("raw markup passes through unchanged", async () => {
    expect(await loadSvgSource(SVG, workspace)).toBe(SVG);
  });

  test("a BOM, XML declaration, comments and a DOCTYPE may precede the root", async () => {
    const text =
      '﻿<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n' +
      SVG;
    expect(await loadSvgSource(text, workspace)).toBe(text);
  });

  test("HTML and a malformed prolog are refused", async () => {
    await expect(loadSvgSource("<html><svg/></html>", workspace)).rejects.toThrow(/<svg>/);
    await expect(loadSvgSource("<?xml version='1.0' <svg/>", workspace)).rejects.toThrow(/<svg>/);
  });

  test("exactly the byte cap succeeds and one byte more fails, counting UTF-8 bytes", async () => {
    expect(await loadSvgSource(svgOfBytes(MAX_SVG_BYTES), workspace)).toHaveLength(
      svgOfBytes(MAX_SVG_BYTES).length
    );
    await expect(loadSvgSource(svgOfBytes(MAX_SVG_BYTES + 1), workspace)).rejects.toThrow(
      String(MAX_SVG_BYTES)
    );
  });

  test("URLs and data URIs are refused without being fetched", async () => {
    await expect(loadSvgSource("https://example.com/a.svg", workspace)).rejects.toThrow(
      /not fetched/
    );
    await expect(loadSvgSource("data:image/svg+xml,<svg/>", workspace)).rejects.toThrow(
      /not fetched/
    );
  });
});

describe("SVG files", () => {
  test("a workspace-relative file is read", async () => {
    await mkdir(path.join(workspace, "icons"));
    await writeFile(path.join(workspace, "icons", "a.svg"), SVG);
    expect(await loadSvgSource("icons/a.svg", workspace)).toBe(SVG);
  });

  test("a directory whose name starts with two dots is still inside", async () => {
    await mkdir(path.join(workspace, "..icons"));
    await writeFile(path.join(workspace, "..icons", "a.svg"), SVG);
    expect(await loadSvgSource("..icons/a.svg", workspace)).toBe(SVG);
  });

  test("a missing file and a directory are refused", async () => {
    await expect(loadSvgSource("nope.svg", workspace)).rejects.toThrow(/not found/);
    await mkdir(path.join(workspace, "dir.svg"));
    await expect(loadSvgSource("dir.svg", workspace)).rejects.toThrow(/regular file/);
  });

  test("a parent-relative and an external absolute path are refused", async () => {
    await writeFile(path.join(outside, "a.svg"), SVG);
    await expect(loadSvgSource("../outside/a.svg", workspace)).rejects.toThrow(/inside/);
    await expect(loadSvgSource(path.join(outside, "a.svg"), workspace)).rejects.toThrow(/inside/);
  });

  test("a directory junction pointing outside is refused", async () => {
    await writeFile(path.join(outside, "a.svg"), SVG);
    await symlink(outside, path.join(workspace, "linked"), "junction");
    await expect(loadSvgSource("linked/a.svg", workspace)).rejects.toThrow(/inside/);
  });

  test("a file over the cap is refused", async () => {
    await writeFile(path.join(workspace, "big.svg"), svgOfBytes(MAX_SVG_BYTES + 1));
    await expect(loadSvgSource("big.svg", workspace)).rejects.toThrow(String(MAX_SVG_BYTES));
  });

  test("a file that is swapped after opening is refused before it is read", async () => {
    await writeFile(path.join(workspace, "a.svg"), SVG);
    await writeFile(path.join(workspace, "b.svg"), SVG);
    const real = await import("node:fs/promises");
    let reads = 0;
    let realpaths = 0;
    const fs: SvgFs = {
      realpath: async (p) => {
        realpaths += 1;
        // The third resolution happens after open: answer with another file.
        const resolved = await real.realpath(p);
        return realpaths === 3 ? resolved.replace(/a\.svg$/, "b.svg") : resolved;
      },
      stat: (p) => real.stat(p),
      open: async (p) => {
        const handle = await real.open(p, "r");
        return {
          stat: () => handle.stat(),
          read: (...args) => {
            reads += 1;
            return handle.read(...args);
          },
          close: () => handle.close(),
        };
      },
    };
    await expect(loadSvgSource("a.svg", workspace, fs)).rejects.toThrow(/changed/);
    expect(reads).toBe(0);
  });
});

describe("readAtMost", () => {
  test("never asks for more than the limit, even from a file that keeps growing", async () => {
    let requested = 0;
    const endless = {
      async read(buffer: Uint8Array, offset: number, length: number) {
        requested += length;
        buffer.fill(97, offset, offset + length);
        return { bytesRead: length };
      },
    };
    const bytes = await readAtMost(endless, 100);
    expect(bytes.length).toBe(100);
    expect(requested).toBe(100);
  });

  test("stops at end of file", async () => {
    const data = Buffer.from("abc");
    let position = 0;
    const file = {
      async read(buffer: Uint8Array, offset: number, length: number) {
        const n = Math.min(length, data.length - position);
        data.copy(buffer, offset, position, position + n);
        position += n;
        return { bytesRead: n };
      },
    };
    expect(Buffer.from(await readAtMost(file, 100)).toString()).toBe("abc");
  });
});

describe("create_svg wire schema", () => {
  test("svgText is bounded in UTF-8 bytes on the follower hop", () => {
    expect(validateRpc("create_svg", undefined, { svgText: svgOfBytes(MAX_SVG_BYTES) }).error).toBe(
      null
    );
    expect(
      validateRpc("create_svg", undefined, { svgText: svgOfBytes(MAX_SVG_BYTES + 1) }).error
    ).toContain(String(MAX_SVG_BYTES));
  });

  test("source never crosses the wire and placement survives", () => {
    const result = validateRpc("create_svg", undefined, {
      svgText: SVG,
      source: "icons/a.svg",
      parentId: "I1:2;3:4",
      width: 20,
    });
    expect(result.error).toBeNull();
    expect(result.params).toEqual({ svgText: SVG, parentId: "I1:2;3:4", width: 20 });
  });

  test("an empty payload is refused", () => {
    expect(validateRpc("create_svg", undefined, { svgText: "" }).error).not.toBeNull();
  });
});
