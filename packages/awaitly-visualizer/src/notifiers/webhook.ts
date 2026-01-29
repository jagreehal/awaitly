/**
 * Webhook Notifier
 *
 * Generic HTTP webhook notifier for pushing workflow visualizations
 * to custom dashboards or services.
 */

import type { Notifier, BaseNotifierOptions, ProviderOptions } from "./types";
import { createNotifier } from "./base";
import {
  createWebhookAdapter,
  type WebhookAdapterOptions,
} from "./adapters/webhook";

// Re-export WebhookPayload for backwards compatibility
export type { WebhookPayload } from "./adapters/webhook";

/**
 * Options for webhook notifier.
 */
export interface WebhookNotifierOptions extends BaseNotifierOptions {
  /** Webhook URL to POST to */
  url: string;
  /** Optional headers to include in requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to include raw mermaid text (default: false) */
  includeMermaid?: boolean;
  /**
   * Whether to include diagram URL (default: true).
   * @deprecated Use includeDiagramUrl instead
   */
  includeKrokiUrl?: boolean;
  /** Whether to include diagram URL (default: true) */
  includeDiagramUrl?: boolean;
  /**
   * Diagram rendering provider configuration.
   * REQUIRED - no silent default to prevent surprise network calls.
   */
  diagramProvider: ProviderOptions;
}

/**
 * Create a webhook notifier.
 *
 * @param options - Webhook configuration
 * @returns A Notifier instance
 *
 * @example
 * ```typescript
 * import { createWebhookNotifier } from 'awaitly-visualizer/notifiers/webhook';
 *
 * // Using Kroki (default)
 * const webhook = createWebhookNotifier({
 *   url: 'https://my-dashboard.com/workflow-events',
 *   headers: { 'X-API-Key': 'secret' },
 *   diagramProvider: { provider: 'kroki' },
 * });
 *
 * // Using mermaid.ink with dark theme
 * const webhookDark = createWebhookNotifier({
 *   url: 'https://my-dashboard.com/workflow-events',
 *   diagramProvider: {
 *     provider: 'mermaid-ink',
 *     theme: 'dark',
 *     bgColor: '1b1b1f',
 *   },
 * });
 *
 * // One-time notification
 * await webhook.notify(workflowIR, { title: 'Order Processing' });
 *
 * // Live updates
 * const live = webhook.createLive({ title: 'Order #123' });
 * workflow.on('event', (e) => live.update(e));
 * await live.finalize();
 * ```
 */
export function createWebhookNotifier(
  options: WebhookNotifierOptions
): Notifier {
  const {
    url,
    headers,
    timeout,
    includeMermaid,
    includeKrokiUrl,
    includeDiagramUrl,
    diagramProvider,
    ...baseOptions
  } = options;

  const adapter = createWebhookAdapter({
    url,
    headers,
    timeout,
    includeMermaid,
    includeKrokiUrl,
    includeDiagramUrl,
    providerName: diagramProvider?.provider ?? "kroki",
  });

  return createNotifier({ ...baseOptions, diagramProvider }, adapter);
}
