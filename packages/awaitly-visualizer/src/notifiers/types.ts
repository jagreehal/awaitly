/**
 * Notifier Types
 *
 * Interfaces for notification systems that push workflow visualizations
 * to external services like Slack, Discord, or custom webhooks.
 */

import type { AsyncResult } from "awaitly";
import type { WorkflowEvent } from "awaitly/workflow";
import type {
  FlowNode,
  WorkflowIR,
  ScopeStartEvent,
  ScopeEndEvent,
  DecisionStartEvent,
  DecisionBranchEvent,
  DecisionEndEvent,
} from "../types";
import type { MermaidInkOptions, MermaidInkTheme } from "../kroki/mermaid-ink";
import type { UrlGeneratorOptions } from "../kroki/url";

/**
 * Extended event types that the live session can handle.
 * Includes both core WorkflowEvent and visualizer-specific events.
 */
export type LiveSessionEvent =
  | WorkflowEvent<unknown>
  | ScopeStartEvent
  | ScopeEndEvent
  | DecisionStartEvent
  | DecisionBranchEvent
  | DecisionEndEvent;

/**
 * Error types for notifier operations.
 */
export type NotifyError = "SEND_FAILED" | "INVALID_CONFIG";

/**
 * Diagram rendering provider.
 */
export type DiagramProvider = "kroki" | "mermaid-ink";

/**
 * Options for Kroki provider.
 */
export interface KrokiProviderOptions extends UrlGeneratorOptions {
  /** Provider type */
  provider: "kroki";
}

/**
 * Options for mermaid.ink provider.
 */
export interface MermaidInkProviderOptions extends MermaidInkOptions {
  /** Provider type */
  provider: "mermaid-ink";
}

/**
 * Combined provider options.
 */
export type ProviderOptions = KrokiProviderOptions | MermaidInkProviderOptions;

/**
 * Status of a workflow when finalized.
 */
export type WorkflowStatus = "completed" | "failed" | "cancelled";

/**
 * Options for creating a live session.
 */
export interface LiveSessionOptions {
  /** Title for the notification (e.g., "Order #123 Processing") */
  title: string;
  /** Debounce interval in milliseconds (default: 500) */
  debounceMs?: number;
  /** Max time between posts even during constant updates (default: 5000) */
  maxWaitMs?: number;
  /** Additional metadata to include in notifications */
  metadata?: Record<string, unknown>;
}

/**
 * Live session for real-time workflow updates.
 *
 * Behavior:
 * - First `update()`: Posts new message with Kroki URL
 * - Subsequent `update()`: Edits same message (debounced)
 * - `finalize()`: Posts final state, marks session complete
 * - `cancel()`: Aborts session, optionally deletes partial message
 */
export interface LiveSession {
  /** Update the visualization (debounced) */
  update(eventOrIr: LiveSessionEvent | WorkflowIR): void;

  /** Finalize the session with final status */
  finalize(status?: WorkflowStatus): Promise<void>;

  /** Cancel the session, optionally deleting the message */
  cancel(): void;

  /** Get the current session ID (e.g., message timestamp for Slack) */
  getSessionId(): string | undefined;

  /** Check if the session is still active */
  isActive(): boolean;
}

/**
 * Result of a notification operation.
 */
export interface NotifyResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Platform-specific message ID */
  messageId?: string;
}

/**
 * Notifier interface for pushing workflow visualizations.
 */
export interface Notifier {
  /** Send a one-time notification with the current workflow state */
  notify(ir: WorkflowIR, options?: NotifyOptions): AsyncResult<string | undefined, NotifyError>;

  /** Create a live session for real-time updates */
  createLive(options: LiveSessionOptions): LiveSession;

  /** Get the notifier type (e.g., "slack", "discord", "webhook") */
  getType(): string;
}

/**
 * Options for one-time notifications.
 */
export interface NotifyOptions {
  /** Title for the notification */
  title?: string;
  /** Additional text content */
  text?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Base options for all notifiers.
 */
export interface BaseNotifierOptions {
  /** Debounce interval in milliseconds for live sessions (default: 500) */
  debounceMs?: number;
  /** Max wait between updates during constant churn (default: 5000) */
  maxWaitMs?: number;
  /**
   * Diagram rendering provider configuration.
   * REQUIRED - no silent default to prevent surprise network calls.
   *
   * @example
   * ```typescript
   * // Use Kroki
   * { provider: 'kroki' }
   *
   * // Use mermaid.ink with dark theme
   * { provider: 'mermaid-ink', theme: 'dark', bgColor: '1b1b1f' }
   *
   * // Use self-hosted Kroki
   * { provider: 'kroki', baseUrl: 'https://kroki.internal' }
   * ```
   */
  diagramProvider: ProviderOptions;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Recursively count step nodes in a workflow IR.
 * Counts steps nested inside parallel, race, and decision containers.
 */
export function countSteps(ir: WorkflowIR): number {
  function countInNodes(nodes: FlowNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.type === "step") {
        count++;
      } else if (node.type === "decision" && node.branches) {
        // Only count from branches (taken branch children); skip node.children to avoid double-counting when both exist
        for (const branch of node.branches) {
          if (branch.taken) {
            count += countInNodes(branch.children);
          }
        }
      } else if ("children" in node && node.children) {
        count += countInNodes(node.children);
      }
    }
    return count;
  }
  return countInNodes(ir.root.children);
}
