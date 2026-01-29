/**
 * Unified Export URL Generation
 *
 * Generates export URLs from diagram sources using configured providers.
 * Decoupled from IR - takes already-rendered diagram text.
 */

import { ok, err, type Result } from "awaitly";
import { buildKrokiUrl } from "../kroki/url";
import { buildMermaidInkUrl } from "../kroki/mermaid-ink";
import type {
  DiagramSource,
  ExportFormat,
  ExportOptions,
  KrokiExportOptions,
  MermaidInkExportOptions,
} from "../types";

/**
 * Error types for export URL generation.
 */
export type ExportUrlError =
  | "UNSUPPORTED_DIAGRAM_KIND"
  | "UNSUPPORTED_FORMAT"
  | "UNKNOWN_PROVIDER";

/**
 * Internal context for export operations.
 * Used to provide caller context in error messages.
 */
interface ExportContext {
  /** The calling method name (e.g., "toSvgUrl") */
  caller?: string;
}

/**
 * Validate that the provider supports the requested format for the diagram kind.
 */
function validateFormatSupported(
  provider: ExportOptions["provider"],
  diagramKind: DiagramSource["kind"],
  format: ExportFormat
): Result<void, ExportUrlError> {
  // mermaid-ink supports all formats for mermaid diagrams
  if (provider === "mermaid-ink" && diagramKind === "mermaid") return ok(undefined);

  // Kroki supports svg/png for mermaid diagrams (not PDF)
  if (provider === "kroki" && diagramKind === "mermaid") {
    if (format === "pdf") {
      return err("UNSUPPORTED_FORMAT");
    }
    return ok(undefined); // svg/png are supported
  }

  // Future-proof default: reject unsupported combinations
  return err("UNSUPPORTED_FORMAT");
}

/**
 * Map internal diagram kind to Kroki's diagramType param.
 * Explicit map prevents breakage if internal names diverge from Kroki's API.
 */
function toKrokiDiagramType(
  kind: DiagramSource["kind"]
): "mermaid" | "graphviz" | "plantuml" {
  switch (kind) {
    case "mermaid":
      return "mermaid";
    case "graphviz":
      return "graphviz";
    case "plantuml":
      return "plantuml";
  }
}

/**
 * Map ExportFormat to mermaid.ink format.
 * mermaid.ink uses "img" for PNG, not "png".
 */
function toMermaidInkFormat(format: ExportFormat): "svg" | "img" | "pdf" {
  switch (format) {
    case "svg":
      return "svg";
    case "png":
      return "img";
    case "pdf":
      return "pdf";
  }
}

/**
 * Generate export URL from diagram source.
 * Decoupled from IR - takes already-rendered diagram text.
 *
 * @param diagram - The diagram source (kind + text)
 * @param format - Export format (svg, png, pdf)
 * @param options - Provider-specific options
 * @param ctx - Optional context for error messages
 * @returns Result with export URL or ExportUrlError
 *
 * @example
 * ```typescript
 * const result = toExportUrl(
 *   { kind: "mermaid", source: "flowchart TD\n  A-->B" },
 *   "svg",
 *   { provider: "kroki" }
 * );
 * if (result.ok) {
 *   console.log(result.value);
 * }
 * ```
 */
export function toExportUrl(
  diagram: DiagramSource,
  format: ExportFormat,
  options: ExportOptions,
  ctx: ExportContext = {}
): Result<string, ExportUrlError> {
  // Validate diagram kind (only mermaid supported currently)
  switch (diagram.kind) {
    case "mermaid":
      break;
    case "graphviz":
    case "plantuml":
      return err("UNSUPPORTED_DIAGRAM_KIND");
    default: {
      const _exhaustive: never = diagram;
      return err("UNSUPPORTED_DIAGRAM_KIND");
    }
  }

  // Validate format is supported by provider + diagram kind
  const formatResult = validateFormatSupported(options.provider, diagram.kind, format);
  if (!formatResult.ok) {
    return formatResult;
  }

  // Generate URL via provider-specific helper (explicit option types)
  switch (options.provider) {
    case "kroki":
      return ok(buildKrokiUrl(
        toKrokiDiagramType(diagram.kind),
        format as "svg" | "png", // PDF already rejected above
        diagram.source,
        options as KrokiExportOptions
      ));
    case "mermaid-ink":
      return ok(buildMermaidInkUrl(
        toMermaidInkFormat(format),
        diagram.source,
        options as MermaidInkExportOptions
      ));
    default: {
      const _exhaustive: never = options;
      return err("UNKNOWN_PROVIDER");
    }
  }
}
