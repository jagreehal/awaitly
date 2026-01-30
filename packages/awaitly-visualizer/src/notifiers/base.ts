/**
 * Base Notifier Factory
 *
 * Creates a notifier from an adapter.
 * Handles all shared logic - adapters only handle platform-specific concerns.
 */

import { ok, err, type AsyncResult } from "awaitly";
import type { WorkflowIR } from "../types";
import type {
  Notifier,
  NotifyOptions,
  LiveSession,
  LiveSessionOptions,
  BaseNotifierOptions,
  WorkflowStatus,
  NotifyError,
} from "./types";
import type { NotifierAdapter } from "./adapter";
import { createNotifierContext } from "./context";
import { createLiveSession } from "../live/live-session";

/**
 * Resolve workflow status from IR state.
 */
function resolveStatus(ir: WorkflowIR): WorkflowStatus | "running" {
  switch (ir.root.state) {
    case "success":
      return "completed";
    case "error":
      return "failed";
    case "aborted":
      return "cancelled";
    default:
      return "running";
  }
}

/**
 * Create a notifier from an adapter.
 * Handles all shared logic - adapters only handle platform-specific concerns.
 *
 * @param options - Base notifier options
 * @param adapter - Platform-specific adapter
 * @returns A Notifier instance
 *
 * @example
 * ```typescript
 * const notifier = createNotifier(
 *   { diagramProvider: { provider: 'kroki' } },
 *   createDiscordAdapter({ webhookUrl: '...' })
 * );
 * ```
 */
export function createNotifier<TMessageId = string>(
  options: BaseNotifierOptions,
  adapter: NotifierAdapter<TMessageId>
): Notifier {
  const { diagramProvider, debounceMs = 500, maxWaitMs = 5000 } = options;

  // Validate required options (runtime check for JS consumers)
  if (!diagramProvider) {
    throw new Error(
      `${adapter.name}Notifier: diagramProvider is required. ` +
        `Pass { provider: 'kroki' } or { provider: 'mermaid-ink' }.`
    );
  }

  // Create shared context once
  const ctx = createNotifierContext(diagramProvider);

  async function notify(
    ir: WorkflowIR,
    notifyOptions: NotifyOptions = {}
  ): AsyncResult<string | undefined, NotifyError> {
    const title = notifyOptions.title ?? "Workflow";
    const status = resolveStatus(ir);

    try {
      const message = adapter.buildMessage({ ir, title, status }, ctx);
      const messageId = await adapter.sendNew(message);
      return ok(messageId?.toString());
    } catch {
      return err("SEND_FAILED");
    }
  }

  function createLive(sessionOptions: LiveSessionOptions): LiveSession {
    return createLiveSession(
      {
        ...sessionOptions,
        debounceMs: sessionOptions.debounceMs ?? debounceMs,
        maxWaitMs: sessionOptions.maxWaitMs ?? maxWaitMs,
      },
      {
        async postNew(ir, title) {
          const message = adapter.buildMessage(
            { ir, title, status: "running" },
            ctx
          );
          const messageId = await adapter.sendNew(message);
          return messageId?.toString();
        },

        async updateExisting(messageId, ir, title) {
          const message = adapter.buildMessage(
            { ir, title, status: "running" },
            ctx
          );
          await adapter.sendUpdate(messageId as TMessageId, message);
        },

        async finalize(messageId, ir, title, status) {
          const message = adapter.buildMessage({ ir, title, status }, ctx);
          if (messageId) {
            await adapter.sendUpdate(messageId as TMessageId, message);
          } else {
            await adapter.sendNew(message);
          }
        },

        async cancel(messageId) {
          if (adapter.sendCancel && messageId) {
            await adapter.sendCancel(messageId as TMessageId);
          }
        },
      }
    );
  }

  return {
    notify,
    createLive,
    getType: () => adapter.name.toLowerCase(),
  };
}
