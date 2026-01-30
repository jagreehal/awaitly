/**
 * Slack Adapter
 *
 * Platform-specific adapter for Slack.
 * Handles only Slack-specific message formatting and API calls.
 */

import { ok, err, type Result, type AsyncResult } from "awaitly";
import type { NotifierAdapter, NotifierContext } from "../adapter";
import type { WorkflowIR } from "../../types";
import type { WorkflowStatus } from "../types";

/**
 * Error types for Slack adapter operations.
 */
export type SlackError = "CLIENT_LOAD_FAILED" | "POST_FAILED" | "UPDATE_FAILED";

/**
 * Options for Slack adapter.
 */
export interface SlackAdapterOptions {
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
}

/**
 * Slack block kit message structure.
 */
interface SlackMessage {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
  ts?: string; // For updates
}

/**
 * Slack block types.
 */
type SlackBlock =
  | { type: "header"; text: { type: "plain_text"; text: string } }
  | {
      type: "section";
      text: { type: "mrkdwn"; text: string };
      accessory?: SlackAccessory;
    }
  | { type: "image"; image_url: string; alt_text: string }
  | { type: "context"; elements: Array<{ type: "mrkdwn"; text: string }> }
  | { type: "divider" };

/**
 * Slack accessory types.
 */
interface SlackAccessory {
  type: "image";
  image_url: string;
  alt_text: string;
}

/**
 * Status emojis for Slack.
 */
const STATUS_EMOJIS: Record<WorkflowStatus | "running", string> = {
  running: ":arrows_counterclockwise:",
  completed: ":white_check_mark:",
  failed: ":x:",
  cancelled: ":stop_sign:",
};

/**
 * Minimal Slack Web API interface.
 * This allows us to work without requiring the full @slack/web-api package.
 */
interface SlackWebApi {
  chat: {
    postMessage(
      args: SlackMessage
    ): Promise<{ ok: boolean; ts?: string; error?: string }>;
    update(
      args: SlackMessage & { ts: string }
    ): Promise<{ ok: boolean; error?: string }>;
  };
}

/**
 * Dependencies for Slack adapter (for testing).
 */
export interface SlackAdapterDeps {
  client?: SlackWebApi;
}

/**
 * Create a Slack adapter.
 *
 * @param options - Slack adapter options
 * @param deps - Optional dependencies (for testing)
 * @returns A NotifierAdapter for Slack
 */
export function createSlackAdapter(
  options: SlackAdapterOptions,
  deps?: SlackAdapterDeps
): NotifierAdapter<string> {
  const { token, channel, username, iconEmoji, iconUrl } = options;

  // Lazy-load Slack client
  let client: SlackWebApi | undefined = deps?.client;

  async function getClient(): AsyncResult<SlackWebApi, SlackError> {
    if (client) return ok(client);

    try {
      // Dynamic import to avoid bundling @slack/web-api when not used
      const { WebClient } = await import("@slack/web-api");
      client = new WebClient(token) as unknown as SlackWebApi;
      return ok(client);
    } catch {
      return err("CLIENT_LOAD_FAILED");
    }
  }

  // Store the title for use in sendNew/sendUpdate
  let currentTitle: string = "Workflow";

  return {
    name: "Slack",

    buildMessage(
      {
        ir,
        title,
        status,
      }: { ir: WorkflowIR; title: string; status: WorkflowStatus | "running" },
      ctx: NotifierContext
    ): SlackMessage {
      // Store title for use in API calls
      currentTitle = title;

      const emoji = STATUS_EMOJIS[status];
      const blocks: SlackBlock[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `${emoji} ${title}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Steps:* ${ctx.countSteps(ir)} | *Duration:* ${ctx.formatDuration(ir)} | *Status:* ${status}`,
          },
        },
        {
          type: "image",
          image_url: ctx.getDiagramUrl(ir),
          alt_text: `Workflow diagram: ${title}`,
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Updated: <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`,
            },
          ],
        },
      ];

      return {
        channel,
        text: title,
        blocks,
        username,
        icon_emoji: iconEmoji,
        icon_url: iconUrl,
      };
    },

    async sendNew(message: unknown): Promise<string | undefined> {
      const clientResult = await getClient();
      if (!clientResult.ok) {
        throw new Error("Slack client failed to load");
      }
      const slackClient = clientResult.value;
      const slackMessage = message as SlackMessage;

      const result = await slackClient.chat.postMessage(slackMessage);
      if (!result.ok) {
        throw new Error(`Slack post failed: ${result.error}`);
      }
      return result.ts;
    },

    async sendUpdate(messageId: string, message: unknown): Promise<void> {
      const clientResult = await getClient();
      if (!clientResult.ok) {
        throw new Error("Slack client failed to load");
      }
      const slackClient = clientResult.value;
      const slackMessage = message as SlackMessage;

      const result = await slackClient.chat.update({
        ...slackMessage,
        ts: messageId,
      });
      if (!result.ok) {
        throw new Error(`Slack update failed: ${result.error}`);
      }
    },
  };
}
