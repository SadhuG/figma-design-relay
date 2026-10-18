import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { LookupFunction, Socket } from "node:net";
import { VERSION } from "./version.js";

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_REDIRECTS = 5;
const BLOCKED_ADDRESS = "Image URL resolves to a blocked internal address";

/** Resolves a hostname to every address it has. */
export type ResolveHost = (hostname: string) => Promise<LookupAddress[]>;

export interface ImageFetchOptions {
  /** Hostname resolver. Defaults to the system resolver. */
  resolve?: ResolveHost;
  /** Address policy. Defaults to refusing private, loopback and other internal ranges. */
  isBlocked?: (address: string) => boolean;
  /** Deadline for each hop, body included. */
  timeoutMs?: number;
}

const systemResolve: ResolveHost = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Fetches image bytes from a remote URL with redirect and timeout limits.
 * @param source - HTTP or HTTPS image URL.
 * @param options - Resolver, address policy and deadline overrides for tests.
 * @returns Raw image bytes.
 */
export async function fetchImageBytes(
  source: string,
  options: ImageFetchOptions = {}
): Promise<Buffer> {
  const resolve = options.resolve ?? systemResolve;
  const isBlocked = options.isBlocked ?? isBlockedIp;
  const timeoutMs = options.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS;
  let url = new URL(source);
  let redirects = 0;

  while (true) {
    const addresses = await resolveSafeAddresses(url, resolve, isBlocked);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await requestPinned(url, addresses, isBlocked, controller.signal);
      const status = resp.statusCode ?? 0;

      if (status >= 300 && status < 400) {
        resp.destroy();
        const location = resp.headers.location;
        if (!location) {
          throw new Error(`Image redirect missing Location header: ${status}`);
        }
        redirects += 1;
        if (redirects > MAX_IMAGE_REDIRECTS) {
          throw new Error(`Image fetch exceeded ${MAX_IMAGE_REDIRECTS} redirects`);
        }
        url = new URL(location, url);
        continue;
      }

      if (status < 200 || status > 299) {
        resp.destroy();
        throw new Error(`Failed to fetch image: ${status} ${resp.statusMessage ?? ""}`.trimEnd());
      }

      const contentLength = resp.headers["content-length"];
      if (contentLength !== undefined) {
        const size = Number(contentLength);
        if (!Number.isFinite(size) || size < 0 || size > MAX_IMAGE_BYTES) {
          resp.destroy();
          throw new Error(
            size > MAX_IMAGE_BYTES
              ? `Image exceeds ${MAX_IMAGE_BYTES} bytes`
              : "Invalid image Content-Length header"
          );
        }
      }

      // Await the body here so the deadline and error handling cover the entire download.
      return await readBoundedResponse(resp, MAX_IMAGE_BYTES);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Timed out fetching image after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Sends one GET that can only connect to addresses that passed validation.
 *
 * `fetch` resolves the hostname again on its own, so a DNS answer that changes
 * between validation and connection (DNS rebinding) would reach an internal
 * address. Here the socket's lookup answers only with the validated addresses,
 * while the URL still supplies the Host header and the TLS server name, so
 * certificate checks are unchanged. The connected peer is checked as well.
 * @param url - URL to request.
 * @param addresses - Validated addresses, or null when the hostname is a literal IP.
 * @param isBlocked - Address policy, applied again to the connected peer.
 * @param signal - Aborts the request and its body.
 * @returns The response, with its body unread.
 */
function requestPinned(
  url: URL,
  addresses: LookupAddress[] | null,
  isBlocked: (address: string) => boolean,
  signal: AbortSignal
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, {
      method: "GET",
      // A fresh socket per hop: a pooled one may have been opened for another answer.
      agent: false,
      signal,
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "Accept-Encoding": "identity",
        "User-Agent": `figma-design-relay/${VERSION}`,
      },
      ...(addresses ? { lookup: pinnedLookup(addresses) } : {}),
    });
    const refuseUnsafePeer = (socket: Socket) => {
      const peer = socket.remoteAddress;
      if (peer === undefined || isBlocked(unmapIPv4(peer))) {
        req.destroy(new Error(BLOCKED_ADDRESS));
        return false;
      }
      return true;
    };
    req.on("socket", (socket) => {
      socket.once("connect", () => refuseUnsafePeer(socket));
    });
    req.on("response", (resp) => {
      if (refuseUnsafePeer(resp.socket)) resolve(resp);
      else resp.destroy();
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * A socket lookup that answers only with already-validated addresses.
 * @param addresses - Addresses that passed the policy.
 * @returns A lookup function for `http.request`.
 */
function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const family = options.family === 4 || options.family === 6 ? options.family : undefined;
    const candidates = family ? addresses.filter((a) => a.family === family) : addresses;
    if (candidates.length === 0) {
      const err: NodeJS.ErrnoException = new Error("Image URL hostname did not resolve");
      err.code = "ENOTFOUND";
      callback(err, "", 0);
      return;
    }
    if (options.all) {
      callback(null, candidates);
    } else {
      callback(null, candidates[0].address, candidates[0].family);
    }
  };
}

/**
 * Turns an IPv4-mapped IPv6 peer address (`::ffff:1.2.3.4`) back into IPv4.
 * @param address - Peer address as the socket reports it.
 * @returns The IPv4 form when mapped, otherwise the address unchanged.
 */
function unmapIPv4(address: string): string {
  const mapped = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : "";
  return isIP(mapped) === 4 ? mapped : address;
}

/**
 * Validates that an image URL uses a safe public HTTP(S) endpoint.
 * @param url - URL to validate.
 * @param resolve - Hostname resolver.
 * @param isBlocked - Address policy.
 * @returns The validated addresses to connect to, or null for a literal IP.
 */
async function resolveSafeAddresses(
  url: URL,
  resolve: ResolveHost,
  isBlocked: (address: string) => boolean
): Promise<LookupAddress[] | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Image URL must use http or https");
  }
  if (!url.hostname) {
    throw new Error("Image URL must include a hostname");
  }

  const hostname = normalizeHostname(url.hostname);
  const literalIp = isIP(hostname);
  if (literalIp !== 0) {
    if (isBlocked(hostname)) {
      throw new Error(BLOCKED_ADDRESS);
    }
    return null;
  }

  const addresses = await resolve(hostname);
  if (addresses.length === 0) {
    throw new Error("Image URL hostname did not resolve");
  }
  if (addresses.some((address) => isBlocked(address.address))) {
    throw new Error(BLOCKED_ADDRESS);
  }
  return addresses;
}

/**
 * Checks whether an IP address is in a private, loopback, or otherwise blocked range.
 * @param address - IPv4 or IPv6 address string.
 * @returns True if the address is blocked for SSRF protection.
 */
export function isBlockedIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isBlockedIp(mapped);
    const words = mapped.split(":");
    if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
      const [high, low] = words.map((word) => parseInt(word, 16));
      return isBlockedIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return true;
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab][0-9a-f]:/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

/**
 * Strips surrounding brackets from an IPv6 hostname so it can be parsed as an IP.
 * @param hostname - Hostname string, possibly bracketed.
 * @returns Normalized hostname without brackets.
 */
function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Reads a response body up to a maximum byte limit.
 * @param resp - Response with an unread body.
 * @param maxBytes - Maximum number of bytes to accept.
 * @returns Concatenated response bytes.
 */
async function readBoundedResponse(resp: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of resp) {
    const bytes = Buffer.from(chunk as Uint8Array);
    total += bytes.length;
    if (total > maxBytes) {
      throw new Error(`Image exceeds ${maxBytes} bytes`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}
