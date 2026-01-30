/**
 * Kroki Encoder
 *
 * Encodes Mermaid diagram text for Kroki URLs using pako deflate + base64url.
 * Uses Buffer in Node (btoa/atob not available) and btoa/atob in browsers.
 */

import pako from "pako";

/** True when Buffer is available (Node). */
const hasBuffer = typeof globalThis !== "undefined" && "Buffer" in globalThis && typeof (globalThis as { Buffer?: unknown }).Buffer === "function";

/**
 * Base64URL encode bytes (URL-safe base64).
 * Uses `-` and `_` instead of `+` and `/`, and omits padding.
 * Node-safe: uses Buffer when available, otherwise btoa.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let base64: string;
  if (hasBuffer) {
    const B = (globalThis as unknown as { Buffer: { from: (u: Uint8Array) => { toString: (enc: string) => string } } }).Buffer;
    base64 = B.from(bytes).toString("base64");
  } else {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, ""); // Remove padding
}

/**
 * Decode standard base64 to bytes.
 * Node-safe: uses Buffer when available, otherwise atob.
 */
function base64ToBytes(base64: string): Uint8Array {
  if (hasBuffer) {
    const B = (globalThis as unknown as { Buffer: { from: (s: string, enc: string) => Uint8Array } }).Buffer;
    return B.from(base64, "base64");
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode text for Kroki URL.
 * Uses pako deflate compression + base64url encoding.
 *
 * @param text - The text to encode (e.g., Mermaid diagram)
 * @returns URL-safe encoded string
 *
 * @example
 * ```typescript
 * const encoded = encodeForKroki('flowchart TD\n  A-->B');
 * // => "eNpLzs8tyc9NTgQADsMDmA"
 * ```
 */
export function encodeForKroki(text: string): string {
  // Convert string to UTF-8 bytes
  const textEncoder = new TextEncoder();
  const textBytes = textEncoder.encode(text);

  // Compress with deflate
  const compressed = pako.deflate(textBytes);

  // Base64URL encode
  return base64UrlEncode(compressed);
}

/**
 * Decode Kroki URL payload back to text.
 * Uses base64url decoding + pako inflate.
 *
 * @param encoded - The encoded string from a Kroki URL
 * @returns The original text
 *
 * @example
 * ```typescript
 * const text = decodeFromKroki('eNpLzs8tyc9NTgQADsMDmA');
 * // => "flowchart TD\n  A-->B"
 * ```
 */
export function decodeFromKroki(encoded: string): string {
  // Convert URL-safe base64 to standard base64
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if needed
  const padding = 4 - (base64.length % 4);
  if (padding !== 4) {
    base64 += "=".repeat(padding);
  }

  const bytes = base64ToBytes(base64);
  const decompressed = pako.inflate(bytes);
  const textDecoder = new TextDecoder();
  return textDecoder.decode(decompressed);
}
