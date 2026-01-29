/**
 * Notifier Adapters
 *
 * Platform-specific adapters for different notification services.
 */

export { createDiscordAdapter, type DiscordAdapterOptions } from "./discord";
export {
  createSlackAdapter,
  type SlackAdapterOptions,
  type SlackAdapterDeps,
} from "./slack";
export {
  createWebhookAdapter,
  type WebhookAdapterOptions,
  type WebhookPayload,
} from "./webhook";
