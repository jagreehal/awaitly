/**
 * awaitly/webhook
 *
 * HTTP webhook handlers: turn workflows into HTTP endpoints with
 * request validation, error mapping, and framework adapters.
 *
 * @example
 * ```typescript
 * import { createWebhookHandler, createExpressHandler } from 'awaitly/webhook';
 *
 * const handler = createWebhookHandler(workflow, async (req, run) => {
 *   const result = await run(async (step) => {
 *     const user = await step(fetchUser(req.body.userId));
 *     return user;
 *   });
 *   return result;
 * });
 *
 * // Express adapter
 * app.post('/api/users', createExpressHandler(handler));
 * ```
 */

export {
  // Types
  type WebhookRequest,
  type WebhookResponse,
  type ErrorResponseBody,
  type ValidationResult,
  type ValidationError,
  type WebhookHandlerConfig,
  type WebhookHandler,
  type SimpleHandlerConfig,
  type ErrorMapping,
  type EventMessage,
  type EventProcessingResult,
  type EventTriggerConfig,
  type EventHandler,
  type ExpressLikeRequest,
  type ExpressLikeResponse,

  // Type guards
  isValidationError,

  // Functions
  createWebhookHandler,
  createSimpleHandler,
  createEventHandler,
  createResultMapper,
  defaultValidationErrorMapper,
  defaultUnexpectedErrorMapper,
  toWebhookRequest,
  sendWebhookResponse,
  createExpressHandler,
  validationError,
  requireFields,
  composeValidators,
} from "./webhook";
