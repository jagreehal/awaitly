/**
 * Notifier Adapter Types
 *
 * Defines the adapter pattern interfaces for platform-specific notifiers.
 * Adapters handle ONLY platform-specific concerns while shared logic
 * lives in the base notifier.
 */

import type { WorkflowIR } from "../types";
import type { WorkflowStatus } from "./types";

/**
 * Context provided to adapters - shared utilities.
 * Following fn(args, deps) pattern.
 */
export interface NotifierContext {
  /** Generate diagram URL from workflow IR */
  getDiagramUrl: (ir: WorkflowIR) => string;
  /** Count total steps in workflow IR */
  countSteps: (ir: WorkflowIR) => number;
  /** Format duration string from workflow IR */
  formatDuration: (ir: WorkflowIR) => string;
}

/**
 * Uniform interface for platform-specific behavior.
 * Each adapter handles ONLY platform-specific concerns.
 */
export interface NotifierAdapter<TMessageId = string> {
  /** Platform name for error messages */
  readonly name: string;

  /** Build platform-specific message from IR */
  buildMessage: (
    args: { ir: WorkflowIR; title: string; status: WorkflowStatus | "running" },
    ctx: NotifierContext
  ) => unknown;

  /** Send a new message, return message ID */
  sendNew: (message: unknown) => Promise<TMessageId | undefined>;

  /** Update an existing message */
  sendUpdate: (messageId: TMessageId, message: unknown) => Promise<void>;

  /** Optional: Delete/cancel a message */
  sendCancel?: (messageId: TMessageId) => Promise<void>;
}

/**
 * Factory function type for creating adapters.
 * Follows fn(args, deps) - options are args, no hidden deps.
 */
export type AdapterFactory<TOptions, TMessageId = string> = (
  options: TOptions
) => NotifierAdapter<TMessageId>;
