/**
 * Slack Notifier
 *
 * Slack notifier for pushing workflow visualizations.
 * Requires @slack/web-api as an optional peer dependency.
 */

import type { Notifier, BaseNotifierOptions, ProviderOptions } from "./types";
import { createNotifier } from "./base";
import {
  createSlackAdapter,
  type SlackAdapterOptions,
  type SlackAdapterDeps,
} from "./adapters/slack";

/**
 * Options for Slack notifier.
 */
export interface SlackNotifierOptions extends BaseNotifierOptions {
  /** Slack Bot OAuth token (xoxb-...) */
  token: string;
  /** Channel ID or name to post to */
  channel: string;
  /** Bot username to display (optional) */
  username?: string;
  /** Bot icon emoji (optional, e.g., ":robot_face:") */
  iconEmoji?: string;
  /** Bot icon URL (optional) */
  iconUrl?: string;
  /**
   * Diagram rendering provider configuration.
   * REQUIRED - no silent default to prevent surprise network calls.
   */
  diagramProvider: ProviderOptions;
}

/**
 * Minimal Slack Web API interface.
 * This allows us to work without requiring the full @slack/web-api package.
 */
interface SlackWebApi {
  chat: {
    postMessage(args: unknown): Promise<{ ok: boolean; ts?: string; error?: string }>;
    update(args: unknown): Promise<{ ok: boolean; error?: string }>;
  };
}

/**
 * Create a Slack notifier.
 *
 * @param options - Slack configuration
 * @param deps - Optional dependencies (for testing)
 * @returns A Notifier instance
 *
 * @example
 * ```typescript
 * import { createSlackNotifier } from 'awaitly-visualizer/notifiers/slack';
 *
 * // Using Kroki (default)
 * const slack = createSlackNotifier({
 *   token: process.env.SLACK_TOKEN!,
 *   channel: '#workflows',
 *   username: 'Workflow Bot',
 *   iconEmoji: ':robot_face:',
 *   diagramProvider: { provider: 'kroki' },
 * });
 *
 * // Using mermaid.ink with dark theme
 * const slackDark = createSlackNotifier({
 *   token: process.env.SLACK_TOKEN!,
 *   channel: '#workflows',
 *   diagramProvider: {
 *     provider: 'mermaid-ink',
 *     theme: 'dark',
 *     bgColor: '1b1b1f',
 *   },
 * });
 *
 * // One-time notification
 * await slack.notify(workflowIR, { title: 'Order Processing' });
 *
 * // Live updates (posts once, then UPDATES same message - no spam)
 * const live = slack.createLive({ title: 'Order #123' });
 * workflow.on('event', (e) => live.update(e));
 * await live.finalize();
 * ```
 */
export function createSlackNotifier(
  options: SlackNotifierOptions,
  deps?: { client?: SlackWebApi }
): Notifier {
  const { token, channel, username, iconEmoji, iconUrl, ...baseOptions } =
    options;

  const adapter = createSlackAdapter(
    {
      token,
      channel,
      username,
      iconEmoji,
      iconUrl,
    },
    deps as SlackAdapterDeps
  );

  return createNotifier(baseOptions, adapter);
}
