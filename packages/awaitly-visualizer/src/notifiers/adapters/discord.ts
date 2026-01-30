/**
 * Discord Adapter
 *
 * Platform-specific adapter for Discord webhooks.
 * Handles only Discord-specific message formatting and API calls.
 */

import { ok, err, type AsyncResult } from "awaitly";
import type { NotifierAdapter, NotifierContext } from "../adapter";
import type { WorkflowIR } from "../../types";
import type { WorkflowStatus } from "../types";

/**
 * Error types for Discord adapter operations.
 */
export type DiscordError = "INVALID_WEBHOOK_URL" | "SEND_FAILED" | "TIMEOUT";

/**
 * Options for Discord adapter.
 */
export interface DiscordAdapterOptions {
  /** Discord webhook URL */
  webhookUrl: string;
  /** Bot username to display (optional) */
  username?: string;
  /** Bot avatar URL (optional) */
  avatarUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Discord webhook message structure.
 */
interface DiscordMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

/**
 * Discord embed structure.
 */
interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  image?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

/**
 * Status colors for Discord embeds.
 */
const STATUS_COLORS: Record<WorkflowStatus | "running", number> = {
  running: 0x3498db, // Blue
  completed: 0x2ecc71, // Green
  failed: 0xe74c3c, // Red
  cancelled: 0x95a5a6, // Gray
};

/**
 * Create a Discord adapter.
 *
 * @param options - Discord adapter options
 * @returns A NotifierAdapter for Discord
 */
export function createDiscordAdapter(
  options: DiscordAdapterOptions
): NotifierAdapter<string> {
  const { webhookUrl, username, avatarUrl, timeout = 30000 } = options;

  // Validate webhook URL
  if (!webhookUrl.includes("discord.com/api/webhooks/")) {
    throw new Error("Invalid Discord webhook URL");
  }

  async function sendMessage(
    message: DiscordMessage,
    messageId?: string
  ): AsyncResult<string | undefined, DiscordError> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Use ?wait=true to get message ID back
      const url = messageId
        ? `${webhookUrl}/messages/${messageId}`
        : `${webhookUrl}?wait=true`;

      const method = messageId ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      if (!response.ok) {
        return err("SEND_FAILED");
      }

      // Extract message ID from response
      const data = (await response.json()) as { id?: string };
      return ok(data.id);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return err("TIMEOUT");
      }
      return err("SEND_FAILED");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    name: "Discord",

    buildMessage(
      {
        ir,
        title,
        status,
      }: { ir: WorkflowIR; title: string; status: WorkflowStatus | "running" },
      ctx: NotifierContext
    ): DiscordMessage {
      const embed: DiscordEmbed = {
        title,
        color: STATUS_COLORS[status],
        image: { url: ctx.getDiagramUrl(ir) },
        fields: [
          { name: "Steps", value: String(ctx.countSteps(ir)), inline: true },
          { name: "Duration", value: ctx.formatDuration(ir), inline: true },
          {
            name: "Status",
            value: status.charAt(0).toUpperCase() + status.slice(1),
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      return {
        username,
        avatar_url: avatarUrl,
        embeds: [embed],
      };
    },

    async sendNew(message: unknown): Promise<string | undefined> {
      const result = await sendMessage(message as DiscordMessage);
      if (!result.ok) {
        throw new Error(`Discord send failed: ${result.error}`);
      }
      return result.value;
    },

    async sendUpdate(messageId: string, message: unknown): Promise<void> {
      const result = await sendMessage(message as DiscordMessage, messageId);
      if (!result.ok) {
        throw new Error(`Discord update failed: ${result.error}`);
      }
    },
  };
}
