import type { ExportFormat } from "./tools.js";

/**
 * MCP tool results are a list of typed content blocks. The server only emitted
 * text blocks before phase 3, which meant screenshots reached agents as base64
 * strings they could not see.
 */
export type ContentBlock =
  { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/**
 * Declared as a type alias rather than an interface on purpose: the MCP SDK
 * types a tool result with an index signature, and only a type alias gets the
 * implicit index signature that makes it assignable.
 */
export type ToolResult = {
  content: ContentBlock[];
  isError?: boolean;
};

/**
 * Formats that MCP clients render inline. SVG and PDF are deliberately absent:
 * client support is inconsistent, so they stay text and are better served by
 * `save_screenshots` writing a real file.
 */
export const IMAGE_MIME_TYPES: Partial<Record<ExportFormat, string>> = {
  PNG: "image/png",
  JPG: "image/jpeg",
};

/**
 * Builds a text content block.
 * @param text - The text to send.
 * @returns The block.
 */
export const textBlock = (text: string): ContentBlock => ({ type: "text", text });

/**
 * Builds an image content block when the format can be rendered inline.
 * @param base64 - Base64-encoded image bytes.
 * @param format - The export format the bytes came from.
 * @returns The block, or null when the format is not inline-renderable.
 */
export const imageBlock = (base64: string, format: ExportFormat): ContentBlock | null => {
  const mimeType = IMAGE_MIME_TYPES[format];
  if (!mimeType || base64 === "") return null;
  return { type: "image", data: base64, mimeType };
};
