/**
 * Hook primitive: suspend workflow until app receives HTTP callback, then resume via injectHook.
 * Server-agnostic; the app owns the URL and calls injectHook when the callback arrives.
 */

import { err, type Err } from "../core";
import type { PendingHook } from "./types";

export const HOOK_STEP_KEY_PREFIX = "hook:" as const;

/**
 * Create a PendingHook error result.
 * Use in a step to suspend the workflow until the app receives a callback and calls injectHook().
 *
 * @param hookId - Stable id for this hook (app uses it in the callback URL, e.g. POST /hook/:hookId)
 * @param options - Optional metadata
 * @returns A Result with a PendingHook error
 */
export function pendingHook(
  hookId: string,
  options?: { metadata?: Record<string, unknown> }
): Err<PendingHook> {
  return err({
    type: "PENDING_HOOK",
    hookId,
    stepKey: HOOK_STEP_KEY_PREFIX + hookId,
    metadata: options?.metadata,
  });
}

/**
 * Create a new hook: generates a unique hookId and returns it with the stepKey for use in the workflow step.
 * The app exposes a URL (e.g. POST /hook/:hookId) and calls injectHook(state, { hookId, value }) when the callback arrives.
 *
 * @returns Object with `hookId` (use in callback URL) and `stepKey` (use with step() and injectHook).
 *
 * @example
 * ```typescript
 * const { hookId, stepKey } = createHook();
 * // Expose POST /hook/:hookId; in handler call injectHook(state, { hookId, value: req.body })
 * await step(() => pendingHook(hookId), { key: stepKey });
 * ```
 */
export function createHook(): { hookId: string; stepKey: string } {
  const hookId = crypto.randomUUID();
  return { hookId, stepKey: HOOK_STEP_KEY_PREFIX + hookId };
}
