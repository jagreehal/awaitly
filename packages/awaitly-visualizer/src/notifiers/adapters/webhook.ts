/**
 * Webhook Adapter
 *
 * Platform-specific adapter for generic HTTP webhooks.
 * Handles only webhook-specific payload formatting and API calls.
 */

import { ok, err, type AsyncResult } from "awaitly";
import type { NotifierAdapter, NotifierContext } from "../adapter";
import type { WorkflowIR, RenderOptions } from "../../types";
import type { WorkflowStatus } from "../types";
import { mermaidRenderer, defaultColorScheme } from "../../renderers";

/**
 * Error types for webhook adapter operations.
 */
export type WebhookError = "SEND_FAILED" | "TIMEOUT";

/**
 * Options for Webhook adapter.
 */
export interface WebhookAdapterOptions {
  /** Webhook URL to POST to */
  url: string;
  /** Optional headers to include in requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to include raw mermaid text (default: false) */
  includeMermaid?: boolean;
  /** Whether to include diagram URL (default: true). Prefer includeDiagramUrl. */
  includeKrokiUrl?: boolean;
  /** Whether to include diagram URL (default: true) */
  includeDiagramUrl?: boolean;
  /** Diagram provider name for payload */
  providerName?: string;
  /** Additional metadata to include in all payloads */
  metadata?: Record<string, unknown>;
}

/**
 * Webhook payload structure.
 */
export interface WebhookPayload {
  /** Event type (e.g., "workflow.update", "workflow.complete") */
  event: string;
  /** Timestamp of the event */
  timestamp: string;
  /** Workflow title */
  title: string;
  /** Workflow status (for finalize events) */
  status?: WorkflowStatus | "running";
  /** Diagram SVG URL (from Kroki or mermaid.ink) */
  diagramUrl?: string;
  /** Kroki SVG URL for visualization. Prefer diagramUrl. */
  krokiUrl?: string;
  /** Diagram provider used ("kroki" or "mermaid-ink") */
  diagramProvider?: string;
  /** Raw Mermaid diagram text */
  mermaid?: string;
  /** The workflow IR */
  ir: WorkflowIR;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Message ID for updates */
  messageId?: string;
}

/**
 * Internal message structure used by the adapter.
 */
interface WebhookMessage {
  payload: WebhookPayload;
}

/**
 * Create a Webhook adapter.
 *
 * @param options - Webhook adapter options
 * @returns A NotifierAdapter for webhooks
 */
export function createWebhookAdapter(
  options: WebhookAdapterOptions
): NotifierAdapter<string> {
  const {
    url,
    headers = {},
    timeout = 30000,
    includeMermaid = false,
    includeKrokiUrl,
    includeDiagramUrl = includeKrokiUrl ?? true,
    providerName = "kroki",
    metadata: baseMetadata,
  } = options;

  const renderer = mermaidRenderer();
  const renderOptions: RenderOptions = {
    showTimings: true,
    showKeys: false,
    terminalWidth: 80,
    colors: defaultColorScheme,
  };

  // Message ID counter for tracking updates
  let messageCounter = 0;

  async function sendWebhook(payload: WebhookPayload): AsyncResult<string, WebhookError> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        return err("SEND_FAILED");
      }

      // Try to extract message ID from response
      try {
        const data = (await response.json()) as {
          messageId?: string;
          id?: string;
        };
        return ok(data.messageId ?? data.id ?? payload.messageId ?? "");
      } catch {
        return ok(payload.messageId ?? "");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return err("TIMEOUT");
      }
      return err("SEND_FAILED");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Generate a session message ID
  function generateMessageId(): string {
    return `webhook-${++messageCounter}-${Date.now()}`;
  }

  return {
    name: "Webhook",

    buildMessage(
      {
        ir,
        title,
        status,
      }: { ir: WorkflowIR; title: string; status: WorkflowStatus | "running" },
      ctx: NotifierContext
    ): WebhookMessage {
      // Determine event type based on status
      let event: string;
      if (status === "running") {
        event = "workflow.update";
      } else {
        event = "workflow.complete";
      }

      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        title,
        status,
        ir,
        metadata: baseMetadata,
      };

      if (includeDiagramUrl) {
        const diagramUrl = ctx.getDiagramUrl(ir);
        payload.diagramUrl = diagramUrl;
        payload.diagramProvider = providerName;
        // Keep krokiUrl for backward compatibility
        payload.krokiUrl = diagramUrl;
      }

      if (includeMermaid) {
        payload.mermaid = renderer.render(ir, renderOptions);
      }

      return { payload };
    },

    async sendNew(message: unknown): Promise<string | undefined> {
      const { payload } = message as WebhookMessage;
      // Generate and attach message ID for new messages
      const messageId = generateMessageId();
      payload.messageId = messageId;
      // Preserve event from buildMessage (workflow.complete for one-shot, workflow.update for live)
      const result = await sendWebhook(payload);
      if (!result.ok) {
        throw new Error(`Webhook send failed: ${result.error}`);
      }
      return messageId;
    },

    async sendUpdate(messageId: string, message: unknown): Promise<void> {
      const { payload } = message as WebhookMessage;
      payload.messageId = messageId;
      // Preserve event from buildMessage (workflow.complete for final, workflow.update for live)
      const result = await sendWebhook(payload);
      if (!result.ok) {
        throw new Error(`Webhook update failed: ${result.error}`);
      }
    },
  };
}
