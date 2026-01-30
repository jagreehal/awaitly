/**
 * Notifier Context Factory
 *
 * Creates shared context for notifier adapters.
 * Single source of truth for diagram URL generation and utilities.
 */

import type { WorkflowIR } from "../types";
import type { ProviderOptions } from "./types";
import type { NotifierContext } from "./adapter";
import { countSteps } from "./types";
import { toKrokiSvgUrl } from "../kroki/url";
import { toMermaidInkSvgUrl } from "../kroki/mermaid-ink";

/**
 * Create shared context for notifier adapters.
 * Single source of truth for diagram URL generation.
 *
 * @param diagramProvider - Provider configuration
 * @returns NotifierContext with shared utilities
 */
export function createNotifierContext(
  diagramProvider: ProviderOptions
): NotifierContext {
  return {
    getDiagramUrl(ir: WorkflowIR): string {
      if (diagramProvider.provider === "mermaid-ink") {
        const { provider: _, ...options } = diagramProvider;
        return toMermaidInkSvgUrl(ir, options);
      }
      // Kroki provider
      return toKrokiSvgUrl(ir, { baseUrl: diagramProvider.baseUrl });
    },

    countSteps(ir: WorkflowIR): number {
      return countSteps(ir);
    },

    formatDuration(ir: WorkflowIR): string {
      if (ir.root.endTs !== undefined && ir.root.startTs !== undefined) {
        return `${ir.root.endTs - ir.root.startTs}ms`;
      }
      if (ir.root.durationMs !== undefined) {
        return `${ir.root.durationMs}ms`;
      }
      return "In progress";
    },
  };
}
