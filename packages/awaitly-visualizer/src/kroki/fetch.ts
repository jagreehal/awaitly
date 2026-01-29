/**
 * Kroki Fetch (Node-only)
 *
 * Downloads rendered diagrams from Kroki as SVG or PNG.
 * This is a separate subpath entry to avoid bundling Node-only code in browser builds.
 */

import { ok, err, type AsyncResult } from "awaitly";
import type { WorkflowIR } from "../types";
import { toKrokiSvgUrl, toKrokiPngUrl, type UrlGeneratorOptions, type UrlGenerator } from "./url";

/**
 * Error types for Kroki fetch operations.
 */
export type KrokiError = "FETCH_ERROR" | "TIMEOUT" | "INVALID_RESPONSE";

/**
 * Options for fetching from Kroki.
 */
export interface FetchKrokiOptions extends UrlGeneratorOptions {
  /** Optional custom URL generator */
  generator?: UrlGenerator;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Fetch SVG content from Kroki.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Fetch options
 * @returns Result with SVG content or KrokiError
 *
 * @example
 * ```typescript
 * import { fetchKrokiSvg } from 'awaitly-visualizer/kroki-fetch';
 *
 * const result = await fetchKrokiSvg(workflowIR);
 * if (result.ok) {
 *   // Write to file or embed in HTML
 *   console.log(result.value);
 * } else {
 *   console.error('Failed:', result.error);
 * }
 * ```
 */
export async function fetchKrokiSvg(
  ir: WorkflowIR,
  options: FetchKrokiOptions = {}
): AsyncResult<string, KrokiError> {
  const { generator, timeout = 30000, ...urlOptions } = options;

  const url = generator
    ? generator.toSvgUrl(ir)
    : toKrokiSvgUrl(ir, urlOptions);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "image/svg+xml",
      },
    });

    if (!response.ok) {
      return err("INVALID_RESPONSE");
    }

    const text = await response.text();
    return ok(text);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return err("TIMEOUT");
    }
    return err("FETCH_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch PNG content from Kroki.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Fetch options
 * @returns Result with PNG content as Buffer or KrokiError
 *
 * @example
 * ```typescript
 * import { fetchKrokiPng } from 'awaitly-visualizer/kroki-fetch';
 * import fs from 'node:fs';
 *
 * const result = await fetchKrokiPng(workflowIR);
 * if (result.ok) {
 *   fs.writeFileSync('workflow.png', result.value);
 * }
 * ```
 */
export async function fetchKrokiPng(
  ir: WorkflowIR,
  options: FetchKrokiOptions = {}
): AsyncResult<Buffer, KrokiError> {
  const { generator, timeout = 30000, ...urlOptions } = options;

  const url = generator
    ? generator.toPngUrl(ir)
    : toKrokiPngUrl(ir, urlOptions);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "image/png",
      },
    });

    if (!response.ok) {
      return err("INVALID_RESPONSE");
    }

    const arrayBuffer = await response.arrayBuffer();
    return ok(Buffer.from(arrayBuffer));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return err("TIMEOUT");
    }
    return err("FETCH_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch PDF content from Kroki.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Fetch options
 * @returns Result with PDF content as Buffer or KrokiError
 *
 * @example
 * ```typescript
 * import { fetchKrokiPdf } from 'awaitly-visualizer/kroki-fetch';
 * import fs from 'node:fs';
 *
 * const result = await fetchKrokiPdf(workflowIR);
 * if (result.ok) {
 *   fs.writeFileSync('workflow.pdf', result.value);
 * }
 * ```
 */
export async function fetchKrokiPdf(
  ir: WorkflowIR,
  options: FetchKrokiOptions = {}
): AsyncResult<Buffer, KrokiError> {
  const { generator, timeout = 30000, ...urlOptions } = options;

  // When generator is provided, use its toPdfUrl directly
  // Otherwise, build PDF URL by modifying the PNG URL path
  const pdfUrl = generator
    ? generator.toPdfUrl(ir)
    : toKrokiPngUrl(ir, urlOptions).replace("/png/", "/pdf/");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(pdfUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/pdf",
      },
    });

    if (!response.ok) {
      return err("INVALID_RESPONSE");
    }

    const arrayBuffer = await response.arrayBuffer();
    return ok(Buffer.from(arrayBuffer));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return err("TIMEOUT");
    }
    return err("FETCH_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}
