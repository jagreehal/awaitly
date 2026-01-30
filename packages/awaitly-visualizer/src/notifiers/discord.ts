/**
 * Discord Notifier
 *
 * Discord webhook notifier for pushing workflow visualizations.
 * Uses plain HTTP webhooks - no Discord SDK required.
 */

import type { Notifier, BaseNotifierOptions, ProviderOptions } from "./types";
import { createNotifier } from "./base";
import { createDiscordAdapter, type DiscordAdapterOptions } from "./adapters/discord";

/**
 * Options for Discord notifier.
 */
export interface DiscordNotifierOptions extends BaseNotifierOptions {
  /** Discord webhook URL */
  webhookUrl: string;
  /** Bot username to display (optional) */
  username?: string;
  /** Bot avatar URL (optional) */
  avatarUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /**
   * Diagram rendering provider configuration.
   * REQUIRED - no silent default to prevent surprise network calls.
   */
  diagramProvider: ProviderOptions;
}

/**
 * Create a Discord notifier.
 *
 * @param options - Discord configuration
 * @returns A Notifier instance
 *
 * @example
 * ```typescript
 * import { createDiscordNotifier } from 'awaitly-visualizer/notifiers/discord';
 *
 * // Using Kroki (default)
 * const discord = createDiscordNotifier({
 *   webhookUrl: process.env.DISCORD_WEBHOOK!,
 *   username: 'Workflow Bot',
 *   diagramProvider: { provider: 'kroki' },
 * });
 *
 * // Using mermaid.ink with dark theme
 * const discordDark = createDiscordNotifier({
 *   webhookUrl: process.env.DISCORD_WEBHOOK!,
 *   diagramProvider: {
 *     provider: 'mermaid-ink',
 *     theme: 'dark',
 *     bgColor: '1b1b1f',
 *   },
 * });
 *
 * // One-time notification
 * await discord.notify(workflowIR, { title: 'Order Processing' });
 *
 * // Live updates
 * const live = discord.createLive({ title: 'Order #123' });
 * workflow.on('event', (e) => live.update(e));
 * await live.finalize();
 * ```
 */
export function createDiscordNotifier(
  options: DiscordNotifierOptions
): Notifier {
  const { webhookUrl, username, avatarUrl, timeout, ...baseOptions } = options;

  const adapter = createDiscordAdapter({
    webhookUrl,
    username,
    avatarUrl,
    timeout,
  });

  return createNotifier(baseOptions, adapter);
}
