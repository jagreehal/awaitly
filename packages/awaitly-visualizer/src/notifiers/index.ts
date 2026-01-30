/**
 * Notifiers module exports.
 *
 * NOTE: Each notifier is also available as a separate subpath export
 * to avoid bundling unused dependencies:
 *
 * - awaitly-visualizer/notifiers/slack
 * - awaitly-visualizer/notifiers/discord
 * - awaitly-visualizer/notifiers/webhook
 */

// Core types
export * from "./types";

// Adapter pattern types
export type { NotifierAdapter, NotifierContext, AdapterFactory } from "./adapter";
export { createNotifierContext } from "./context";
export { createNotifier } from "./base";

// Platform-specific notifiers (public API)
export { createSlackNotifier, type SlackNotifierOptions } from "./slack";
export { createDiscordNotifier, type DiscordNotifierOptions } from "./discord";
export {
  createWebhookNotifier,
  type WebhookNotifierOptions,
  type WebhookPayload,
} from "./webhook";

// Adapters (for advanced users creating custom notifiers)
export {
  createDiscordAdapter,
  type DiscordAdapterOptions,
} from "./adapters/discord";
export {
  createSlackAdapter,
  type SlackAdapterOptions,
  type SlackAdapterDeps,
} from "./adapters/slack";
export {
  createWebhookAdapter,
  type WebhookAdapterOptions,
} from "./adapters/webhook";
