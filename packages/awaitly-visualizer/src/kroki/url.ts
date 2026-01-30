/**
 * Kroki URL Generation
 *
 * Generates shareable URLs for Kroki diagram rendering service.
 * Works in both browser and Node.js environments.
 */

import type { WorkflowIR, RenderOptions, KrokiExportOptions } from "../types";
import { mermaidRenderer, defaultColorScheme } from "../renderers";
import { encodeForKroki } from "./encoder";

/**
 * Supported Kroki output formats.
 */
export type KrokiFormat = "svg" | "png" | "pdf" | "jpeg";

/**
 * Options for URL generator.
 */
export interface UrlGeneratorOptions {
  /** Base URL for Kroki service (default: https://kroki.io) */
  baseUrl?: string;
}

/**
 * Default Kroki base URL.
 */
const DEFAULT_KROKI_URL = "https://kroki.io";

/**
 * Build a Kroki URL for the given diagram.
 *
 * @param diagramType - Diagram type (e.g., "mermaid", "plantuml", "graphviz")
 * @param format - Output format (svg, png, pdf, jpeg)
 * @param text - The diagram text
 * @param options - URL generator options (KrokiExportOptions or legacy UrlGeneratorOptions)
 * @returns The Kroki URL
 *
 * @example
 * ```typescript
 * const url = buildKrokiUrl('mermaid', 'svg', 'flowchart TD\n  A-->B');
 * // => "https://kroki.io/mermaid/svg/eNpLzs8tyc9NTgQADsMDmA"
 *
 * // With explicit KrokiExportOptions
 * const url2 = buildKrokiUrl('mermaid', 'svg', 'flowchart TD\n  A-->B', {
 *   provider: 'kroki',
 *   baseUrl: 'https://kroki.internal'
 * });
 * ```
 */
export function buildKrokiUrl(
  diagramType: string,
  format: KrokiFormat,
  text: string,
  options: KrokiExportOptions | UrlGeneratorOptions = {}
): string {
  const baseUrl = options.baseUrl ?? DEFAULT_KROKI_URL;
  const encoded = encodeForKroki(text);
  return `${baseUrl}/${diagramType}/${format}/${encoded}`;
}

/**
 * Generate a Kroki URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param format - Output format (default: 'svg')
 * @param options - Optional URL generator options
 * @returns The Kroki URL
 *
 * @example
 * ```typescript
 * const url = toKrokiUrl(workflowIR, 'svg');
 * // Share this URL - image renders when viewed
 * ```
 */
export function toKrokiUrl(
  ir: WorkflowIR,
  format: KrokiFormat = "svg",
  options: UrlGeneratorOptions = {}
): string {
  const renderer = mermaidRenderer();
  const renderOptions: RenderOptions = {
    showTimings: true,
    showKeys: false,
    terminalWidth: 80,
    colors: defaultColorScheme,
  };

  const mermaidText = renderer.render(ir, renderOptions);
  return buildKrokiUrl("mermaid", format, mermaidText, options);
}

/**
 * Generate a Kroki SVG URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Optional URL generator options
 * @returns The Kroki SVG URL
 *
 * @example
 * ```typescript
 * const svgUrl = toKrokiSvgUrl(workflowIR);
 * // => "https://kroki.io/mermaid/svg/eNp..."
 * ```
 */
export function toKrokiSvgUrl(
  ir: WorkflowIR,
  options: UrlGeneratorOptions = {}
): string {
  return toKrokiUrl(ir, "svg", options);
}

/**
 * Generate a Kroki PNG URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Optional URL generator options
 * @returns The Kroki PNG URL
 *
 * @example
 * ```typescript
 * const pngUrl = toKrokiPngUrl(workflowIR);
 * // => "https://kroki.io/mermaid/png/eNp..."
 * ```
 */
export function toKrokiPngUrl(
  ir: WorkflowIR,
  options: UrlGeneratorOptions = {}
): string {
  return toKrokiUrl(ir, "png", options);
}

/**
 * URL Generator with configured base URL.
 */
export interface UrlGenerator {
  /** Generate URL with specified format */
  toUrl(ir: WorkflowIR, format: KrokiFormat): string;
  /** Generate SVG URL */
  toSvgUrl(ir: WorkflowIR): string;
  /** Generate PNG URL */
  toPngUrl(ir: WorkflowIR): string;
  /** Generate PDF URL */
  toPdfUrl(ir: WorkflowIR): string;
  /** Get the configured base URL */
  getBaseUrl(): string;
}

/**
 * Create a URL generator with a custom base URL.
 * Useful for self-hosted Kroki instances.
 *
 * @param options - URL generator options
 * @returns A URL generator instance
 *
 * @example
 * ```typescript
 * // Use self-hosted Kroki
 * const generator = createUrlGenerator({ baseUrl: 'https://my-kroki.internal' });
 * const url = generator.toSvgUrl(workflowIR);
 *
 * // Default public Kroki
 * const defaultGenerator = createUrlGenerator();
 * const publicUrl = defaultGenerator.toSvgUrl(workflowIR);
 * ```
 */
export function createUrlGenerator(options: UrlGeneratorOptions = {}): UrlGenerator {
  const baseUrl = options.baseUrl ?? DEFAULT_KROKI_URL;

  return {
    toUrl(ir: WorkflowIR, format: KrokiFormat): string {
      return toKrokiUrl(ir, format, { baseUrl });
    },

    toSvgUrl(ir: WorkflowIR): string {
      return toKrokiUrl(ir, "svg", { baseUrl });
    },

    toPngUrl(ir: WorkflowIR): string {
      return toKrokiUrl(ir, "png", { baseUrl });
    },

    toPdfUrl(ir: WorkflowIR): string {
      return toKrokiUrl(ir, "pdf", { baseUrl });
    },

    getBaseUrl(): string {
      return baseUrl;
    },
  };
}
