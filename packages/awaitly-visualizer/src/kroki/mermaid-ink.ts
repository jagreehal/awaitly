/**
 * Mermaid.ink URL Generation
 *
 * Generates shareable URLs for mermaid.ink diagram rendering service.
 * Alternative to Kroki with additional features like themes, background colors, and sizing.
 *
 * @see https://mermaid.ink/
 */

import type { WorkflowIR, RenderOptions, MermaidInkExportOptions } from "../types";
import { mermaidRenderer, defaultColorScheme } from "../renderers";
import { encodeForKroki } from "./encoder";

/**
 * Supported mermaid.ink output formats.
 */
export type MermaidInkFormat = "svg" | "img" | "pdf";

/**
 * Image type for /img endpoint.
 */
export type MermaidInkImageType = "jpeg" | "png" | "webp";

/**
 * Mermaid.ink built-in themes.
 */
export type MermaidInkTheme = "default" | "neutral" | "dark" | "forest";

/**
 * PDF paper sizes.
 */
export type MermaidInkPaperSize =
  | "letter"
  | "legal"
  | "tabloid"
  | "ledger"
  | "a0"
  | "a1"
  | "a2"
  | "a3"
  | "a4"
  | "a5"
  | "a6";

/**
 * Options for mermaid.ink URL generation.
 */
export interface MermaidInkOptions {
  /** Base URL for mermaid.ink service (default: https://mermaid.ink) */
  baseUrl?: string;

  /**
   * Background color.
   * - Hex color without #: "FF0000" for red
   * - Named color with ! prefix: "!white", "!black"
   */
  bgColor?: string;

  /** Mermaid theme */
  theme?: MermaidInkTheme;

  /** Image width in pixels */
  width?: number;

  /** Image height in pixels */
  height?: number;

  /** Image scale (1-3). Only applies if width or height is set */
  scale?: number;

  /** Image type for /img endpoint (default: jpeg) */
  imageType?: MermaidInkImageType;

  // PDF-specific options

  /** Fit PDF size to diagram size */
  fit?: boolean;

  /** Paper size for PDF (default: a4) */
  paper?: MermaidInkPaperSize;

  /** Landscape orientation for PDF */
  landscape?: boolean;
}

/**
 * Default mermaid.ink base URL.
 */
const DEFAULT_MERMAID_INK_URL = "https://mermaid.ink";

/**
 * Encode text for mermaid.ink URL.
 * Uses pako deflate compression + base64 encoding with "pako:" prefix.
 *
 * @param text - The Mermaid diagram text
 * @returns Encoded string with "pako:" prefix
 */
export function encodeForMermaidInk(text: string): string {
  const encoded = encodeForKroki(text);
  return `pako:${encoded}`;
}

/**
 * Normalize export options to internal MermaidInkOptions.
 * Maps MermaidInkExportOptions fields to MermaidInkOptions fields.
 */
function normalizeOptions(
  options: MermaidInkOptions | MermaidInkExportOptions
): MermaidInkOptions {
  // If it's MermaidInkExportOptions (has "provider" field), normalize it
  if ("provider" in options) {
    const exportOpts = options as MermaidInkExportOptions;
    return {
      theme: exportOpts.mermaidTheme,
      bgColor: exportOpts.background,
      scale: exportOpts.scale,
      fit: exportOpts.fit,
      width: exportOpts.width,
      height: exportOpts.height,
      paper: exportOpts.paper as MermaidInkPaperSize | undefined,
      // MermaidInkExportOptions uses "png" format via toExportUrl, set imageType
      imageType: "png",
    };
  }
  // Already MermaidInkOptions
  return options;
}

/**
 * Build query string from options.
 */
function buildQueryString(
  format: MermaidInkFormat,
  options: MermaidInkOptions
): string {
  const params: string[] = [];

  // Common options
  if (options.bgColor) {
    params.push(`bgColor=${encodeURIComponent(options.bgColor)}`);
  }
  if (options.theme) {
    params.push(`theme=${options.theme}`);
  }
  if (options.width !== undefined) {
    params.push(`width=${options.width}`);
  }
  if (options.height !== undefined) {
    params.push(`height=${options.height}`);
  }
  if (options.scale !== undefined && (options.width !== undefined || options.height !== undefined)) {
    params.push(`scale=${options.scale}`);
  }

  // Image-specific options
  if (format === "img" && options.imageType && options.imageType !== "jpeg") {
    params.push(`type=${options.imageType}`);
  }

  // PDF-specific options
  if (format === "pdf") {
    if (options.fit) {
      params.push("fit");
    }
    if (options.paper && !options.fit) {
      params.push(`paper=${options.paper}`);
    }
    if (options.landscape && !options.fit) {
      params.push("landscape");
    }
  }

  return params.length > 0 ? `?${params.join("&")}` : "";
}

/**
 * Build a mermaid.ink URL for the given Mermaid diagram text.
 *
 * @param format - Output format (svg, img, pdf)
 * @param text - The Mermaid diagram text
 * @param options - Optional mermaid.ink options (MermaidInkOptions or MermaidInkExportOptions)
 * @returns The mermaid.ink URL
 *
 * @example
 * ```typescript
 * const url = buildMermaidInkUrl('svg', 'flowchart TD\n  A-->B');
 * // => "https://mermaid.ink/svg/pako:eNpLzs8tyc9NTgQADsMDmA"
 *
 * const darkUrl = buildMermaidInkUrl('svg', 'flowchart TD\n  A-->B', {
 *   theme: 'dark',
 *   bgColor: '1b1b1f'
 * });
 * // => "https://mermaid.ink/svg/pako:eNp...?theme=dark&bgColor=1b1b1f"
 *
 * // With MermaidInkExportOptions
 * const exportUrl = buildMermaidInkUrl('svg', 'flowchart TD\n  A-->B', {
 *   provider: 'mermaid-ink',
 *   mermaidTheme: 'dark',
 *   background: '1b1b1f'
 * });
 * ```
 */
export function buildMermaidInkUrl(
  format: MermaidInkFormat,
  text: string,
  options: MermaidInkOptions | MermaidInkExportOptions = {}
): string {
  const normalized = normalizeOptions(options);
  const baseUrl = normalized.baseUrl ?? DEFAULT_MERMAID_INK_URL;
  const encoded = encodeForMermaidInk(text);
  const queryString = buildQueryString(format, normalized);
  return `${baseUrl}/${format}/${encoded}${queryString}`;
}

/**
 * Generate a mermaid.ink URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param format - Output format (default: 'svg')
 * @param options - Optional mermaid.ink options
 * @returns The mermaid.ink URL
 *
 * @example
 * ```typescript
 * const url = toMermaidInkUrl(workflowIR, 'svg');
 * // Share this URL - image renders when viewed
 *
 * const darkUrl = toMermaidInkUrl(workflowIR, 'svg', { theme: 'dark' });
 * ```
 */
export function toMermaidInkUrl(
  ir: WorkflowIR,
  format: MermaidInkFormat = "svg",
  options: MermaidInkOptions = {}
): string {
  const renderer = mermaidRenderer();
  const renderOptions: RenderOptions = {
    showTimings: true,
    showKeys: false,
    terminalWidth: 80,
    colors: defaultColorScheme,
  };

  const mermaidText = renderer.render(ir, renderOptions);
  return buildMermaidInkUrl(format, mermaidText, options);
}

/**
 * Generate a mermaid.ink SVG URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Optional mermaid.ink options
 * @returns The mermaid.ink SVG URL
 *
 * @example
 * ```typescript
 * const svgUrl = toMermaidInkSvgUrl(workflowIR);
 * // => "https://mermaid.ink/svg/pako:eNp..."
 *
 * const darkSvg = toMermaidInkSvgUrl(workflowIR, { theme: 'dark' });
 * ```
 */
export function toMermaidInkSvgUrl(
  ir: WorkflowIR,
  options: MermaidInkOptions = {}
): string {
  return toMermaidInkUrl(ir, "svg", options);
}

/**
 * Generate a mermaid.ink PNG URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Optional mermaid.ink options
 * @returns The mermaid.ink PNG URL
 *
 * @example
 * ```typescript
 * const pngUrl = toMermaidInkPngUrl(workflowIR);
 * // => "https://mermaid.ink/img/pako:eNp...?type=png"
 *
 * const scaledPng = toMermaidInkPngUrl(workflowIR, { width: 800, scale: 2 });
 * ```
 */
export function toMermaidInkPngUrl(
  ir: WorkflowIR,
  options: MermaidInkOptions = {}
): string {
  return toMermaidInkUrl(ir, "img", { ...options, imageType: "png" });
}

/**
 * Generate a mermaid.ink JPEG URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Optional mermaid.ink options
 * @returns The mermaid.ink JPEG URL
 */
export function toMermaidInkJpegUrl(
  ir: WorkflowIR,
  options: MermaidInkOptions = {}
): string {
  return toMermaidInkUrl(ir, "img", { ...options, imageType: "jpeg" });
}

/**
 * Generate a mermaid.ink WebP URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Optional mermaid.ink options
 * @returns The mermaid.ink WebP URL
 */
export function toMermaidInkWebpUrl(
  ir: WorkflowIR,
  options: MermaidInkOptions = {}
): string {
  return toMermaidInkUrl(ir, "img", { ...options, imageType: "webp" });
}

/**
 * Generate a mermaid.ink PDF URL from workflow IR.
 *
 * @param ir - Workflow intermediate representation
 * @param options - Optional mermaid.ink options (fit, paper, landscape)
 * @returns The mermaid.ink PDF URL
 *
 * @example
 * ```typescript
 * // Fit PDF to diagram size
 * const fitPdf = toMermaidInkPdfUrl(workflowIR, { fit: true });
 *
 * // A3 landscape
 * const a3Pdf = toMermaidInkPdfUrl(workflowIR, { paper: 'a3', landscape: true });
 * ```
 */
export function toMermaidInkPdfUrl(
  ir: WorkflowIR,
  options: MermaidInkOptions = {}
): string {
  return toMermaidInkUrl(ir, "pdf", options);
}

/**
 * Mermaid.ink URL Generator interface.
 */
export interface MermaidInkGenerator {
  /** Generate URL with specified format */
  toUrl(ir: WorkflowIR, format: MermaidInkFormat): string;
  /** Generate SVG URL */
  toSvgUrl(ir: WorkflowIR): string;
  /** Generate PNG URL */
  toPngUrl(ir: WorkflowIR): string;
  /** Generate JPEG URL */
  toJpegUrl(ir: WorkflowIR): string;
  /** Generate WebP URL */
  toWebpUrl(ir: WorkflowIR): string;
  /** Generate PDF URL */
  toPdfUrl(ir: WorkflowIR): string;
  /** Get the configured base URL */
  getBaseUrl(): string;
  /** Get the configured options */
  getOptions(): MermaidInkOptions;
}

/**
 * Create a mermaid.ink URL generator with default options.
 * Useful for consistent theming across all generated URLs.
 *
 * @param options - Default mermaid.ink options applied to all URLs
 * @returns A mermaid.ink URL generator instance
 *
 * @example
 * ```typescript
 * // Create generator with dark theme defaults
 * const generator = createMermaidInkGenerator({
 *   theme: 'dark',
 *   bgColor: '1b1b1f',
 * });
 *
 * // All URLs will use dark theme
 * const svgUrl = generator.toSvgUrl(workflowIR);
 * const pngUrl = generator.toPngUrl(workflowIR);
 *
 * // Self-hosted mermaid.ink
 * const privateGenerator = createMermaidInkGenerator({
 *   baseUrl: 'https://mermaid.internal.company.com',
 * });
 * ```
 */
export function createMermaidInkGenerator(
  options: MermaidInkOptions = {}
): MermaidInkGenerator {
  const baseUrl = options.baseUrl ?? DEFAULT_MERMAID_INK_URL;

  return {
    toUrl(ir: WorkflowIR, format: MermaidInkFormat): string {
      return toMermaidInkUrl(ir, format, options);
    },

    toSvgUrl(ir: WorkflowIR): string {
      return toMermaidInkUrl(ir, "svg", options);
    },

    toPngUrl(ir: WorkflowIR): string {
      return toMermaidInkUrl(ir, "img", { ...options, imageType: "png" });
    },

    toJpegUrl(ir: WorkflowIR): string {
      return toMermaidInkUrl(ir, "img", { ...options, imageType: "jpeg" });
    },

    toWebpUrl(ir: WorkflowIR): string {
      return toMermaidInkUrl(ir, "img", { ...options, imageType: "webp" });
    },

    toPdfUrl(ir: WorkflowIR): string {
      return toMermaidInkUrl(ir, "pdf", options);
    },

    getBaseUrl(): string {
      return baseUrl;
    },

    getOptions(): MermaidInkOptions {
      return { ...options };
    },
  };
}
