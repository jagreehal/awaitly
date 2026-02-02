/**
 * awaitly/webhook
 *
 * Webhook and event trigger adapters for exposing workflows as HTTP endpoints.
 * Framework-agnostic handlers that work with Express, Hono, Fastify, etc.
 */

import { type Result, type AsyncResult, ok, err, isOk } from "../core";
import { type Workflow, type WorkflowStrict, type UnexpectedError } from "../workflow";

// =============================================================================
// Request/Response Types
// =============================================================================

/**
 * Generic HTTP request representation.
 * Abstracts away framework-specific request objects.
 */
export interface WebhookRequest<Body = unknown> {
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  method: string;
  /** Request path (e.g., "/api/checkout") */
  path: string;
  /** Request headers */
  headers: Record<string, string | string[] | undefined>;
  /** Parsed request body (JSON) */
  body: Body;
  /** Query parameters */
  query: Record<string, string | string[] | undefined>;
  /** Path parameters (e.g., { id: "123" }) */
  params: Record<string, string>;
  /** Raw request object from framework (for advanced use cases) */
  raw?: unknown;
}

/**
 * Generic HTTP response representation.
 */
export interface WebhookResponse<T = unknown> {
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers?: Record<string, string>;
  /** Response body (will be JSON serialized) */
  body: T;
}

/**
 * Error response body structure.
 */
export interface ErrorResponseBody {
  error: {
    type: string;
    message?: string;
    details?: unknown;
  };
}

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Input validation result.
 */
export type ValidationResult<T, E = string> = Result<T, E>;

/**
 * Standard validation error type.
 */
export interface ValidationError {
  type: "VALIDATION_ERROR";
  message: string;
  field?: string;
  details?: unknown;
}

/**
 * Type guard for ValidationError.
 */
export function isValidationError(e: unknown): e is ValidationError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as ValidationError).type === "VALIDATION_ERROR"
  );
}

// =============================================================================
// Handler Configuration
// =============================================================================

/**
 * Configuration for creating a webhook handler.
 *
 * @template TInput - The validated input type
 * @template TOutput - The workflow output type
 * @template TError - The workflow error type
 * @template TBody - The raw request body type
 */
export interface WebhookHandlerConfig<TInput, TOutput, TError, TBody = unknown> {
  /**
   * Validate and transform the incoming request.
   * Return ok(input) to proceed, or err(validationError) to reject.
   *
   * @param req - The incoming request
   * @returns Validated input or validation error
   */
  validateInput: (
    req: WebhookRequest<TBody>
  ) => ValidationResult<TInput, ValidationError> | Promise<ValidationResult<TInput, ValidationError>>;

  /**
   * Map workflow result to HTTP response.
   * Called for both success and error cases.
   *
   * @param result - The workflow result
   * @param req - The original request (for context)
   * @returns HTTP response
   */
  mapResult: (
    result: Result<TOutput, TError | UnexpectedError>,
    req: WebhookRequest<TBody>
  ) => WebhookResponse;

  /**
   * Optional: Map validation errors to HTTP response.
   * Defaults to 400 Bad Request with error details.
   *
   * @param error - The validation error
   * @param req - The original request
   * @returns HTTP response
   */
  mapValidationError?: (
    error: ValidationError,
    req: WebhookRequest<TBody>
  ) => WebhookResponse<ErrorResponseBody>;

  /**
   * Optional: Handle unexpected errors during request processing.
   * Defaults to 500 Internal Server Error.
   *
   * @param error - The unexpected error
   * @param req - The original request
   * @returns HTTP response
   */
  mapUnexpectedError?: (
    error: unknown,
    req: WebhookRequest<TBody>
  ) => WebhookResponse<ErrorResponseBody>;

  /**
   * Optional: Request middleware.
   * Transform or enrich the request before validation.
   *
   * @param req - The incoming request
   * @returns Transformed request
   */
  beforeValidation?: (
    req: WebhookRequest<TBody>
  ) => WebhookRequest<TBody> | Promise<WebhookRequest<TBody>>;

  /**
   * Optional: Response middleware.
   * Transform the response before sending.
   *
   * @param response - The response to send
   * @param req - The original request
   * @returns Transformed response
   */
  afterResponse?: (
    response: WebhookResponse,
    req: WebhookRequest<TBody>
  ) => WebhookResponse | Promise<WebhookResponse>;
}

/**
 * A webhook handler function that processes requests.
 */
export type WebhookHandler<TBody = unknown> = (
  req: WebhookRequest<TBody>
) => Promise<WebhookResponse>;

// =============================================================================
// Default Mappers
// =============================================================================

/**
 * Default validation error mapper.
 * Returns 400 Bad Request with error details.
 */
export function defaultValidationErrorMapper(
  error: ValidationError
): WebhookResponse<ErrorResponseBody> {
  return {
    status: 400,
    body: {
      error: {
        type: error.type,
        message: error.message,
        details: error.field ? { field: error.field } : error.details,
      },
    },
  };
}

/**
 * Default unexpected error mapper.
 * Returns 500 Internal Server Error.
 */
export function defaultUnexpectedErrorMapper(
  _error: unknown
): WebhookResponse<ErrorResponseBody> {
  return {
    status: 500,
    body: {
      error: {
        type: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
  };
}

// =============================================================================
// Workflow Handler Factory
// =============================================================================

/**
 * Create a webhook handler for a workflow.
 *
 * This factory creates an HTTP handler function that:
 * 1. Validates the incoming request
 * 2. Executes the workflow with the validated input
 * 3. Maps the result to an HTTP response
 *
 * The handler is framework-agnostic and returns a standard response object.
 * Use framework adapters (createExpressHandler, createHonoHandler, etc.) to
 * integrate with specific frameworks.
 *
 * @template TInput - The validated input type passed to the workflow
 * @template TOutput - The workflow output type
 * @template TError - The workflow error type
 * @template TBody - The raw request body type
 * @template TDeps - The workflow dependencies type
 *
 * @param workflow - The workflow function to execute
 * @param workflowFn - The workflow body function (step, deps, input) => output
 * @param config - Handler configuration
 * @returns A webhook handler function
 *
 * @example
 * ```typescript
 * const checkoutWorkflow = createWorkflow({ chargeCard, sendEmail });
 *
 * const handler = createWebhookHandler(
 *   checkoutWorkflow,
 *   async (step, deps, input: CheckoutInput) => {
 *     const charge = await step(() => deps.chargeCard(input.amount));
 *     await step(() => deps.sendEmail(input.email, charge.receiptUrl));
 *     return { chargeId: charge.id };
 *   },
 *   {
 *     validateInput: (req) => {
 *       const { amount, email } = req.body;
 *       if (!amount || !email) {
 *         return err({ type: 'VALIDATION_ERROR', message: 'Missing required fields' });
 *       }
 *       return ok({ amount, email });
 *     },
 *     mapResult: (result) => {
 *       if (result.ok) {
 *         return { status: 200, body: result.value };
 *       }
 *       if (result.error === 'CARD_DECLINED') {
 *         return { status: 402, body: { error: { type: 'CARD_DECLINED' } } };
 *       }
 *       return { status: 500, body: { error: { type: 'UNKNOWN' } } };
 *     },
 *   }
 * );
 *
 * // Use with Express
 * app.post('/checkout', async (req, res) => {
 *   const response = await handler(toWebhookRequest(req));
 *   res.status(response.status).json(response.body);
 * });
 * ```
 */
export function createWebhookHandler<
  TInput,
  TOutput,
  TError,
  TBody = unknown,
  TDeps = unknown
>(
  workflow: Workflow<TError, TDeps> | WorkflowStrict<TError, unknown, TDeps>,
  workflowFn: (
    step: Parameters<Parameters<Workflow<TError, TDeps>>[1]>[0],
    deps: TDeps,
    input: TInput
  ) => TOutput | Promise<TOutput>,
  config: WebhookHandlerConfig<TInput, TOutput, TError, TBody>
): WebhookHandler<TBody> {
  const {
    validateInput,
    mapResult,
    mapValidationError = defaultValidationErrorMapper,
    mapUnexpectedError = defaultUnexpectedErrorMapper,
    beforeValidation,
    afterResponse,
  } = config;

  return async (req: WebhookRequest<TBody>): Promise<WebhookResponse> => {
    try {
      // Apply request middleware if provided
      const processedReq = beforeValidation ? await beforeValidation(req) : req;

      // Validate input
      const validationResult = await validateInput(processedReq);

      if (!isOk(validationResult)) {
        const response = mapValidationError(validationResult.error, processedReq);
        return afterResponse ? await afterResponse(response, processedReq) : response;
      }

      // Execute workflow with validated input
      const workflowResult = await (workflow as Workflow<TError, TDeps>)(
        validationResult.value,
        (step, deps) => workflowFn(step, deps, validationResult.value)
      );

      // Map result to response
      const response = mapResult(workflowResult, processedReq);

      // Apply response middleware if provided
      return afterResponse ? await afterResponse(response, processedReq) : response;
    } catch (error) {
      // Handle unexpected errors during request processing
      const response = mapUnexpectedError(error, req);
      return afterResponse ? await afterResponse(response, req) : response;
    }
  };
}

// =============================================================================
// Simple Handler (No Workflow)
// =============================================================================

/**
 * Configuration for a simple webhook handler without workflow.
 */
export interface SimpleHandlerConfig<TInput, TOutput, TError, TBody = unknown> {
  validateInput: (
    req: WebhookRequest<TBody>
  ) => ValidationResult<TInput, ValidationError> | Promise<ValidationResult<TInput, ValidationError>>;

  handler: (input: TInput, req: WebhookRequest<TBody>) => AsyncResult<TOutput, TError>;

  mapResult: (
    result: Result<TOutput, TError>,
    req: WebhookRequest<TBody>
  ) => WebhookResponse;

  mapValidationError?: (
    error: ValidationError,
    req: WebhookRequest<TBody>
  ) => WebhookResponse<ErrorResponseBody>;

  mapUnexpectedError?: (
    error: unknown,
    req: WebhookRequest<TBody>
  ) => WebhookResponse<ErrorResponseBody>;
}

/**
 * Create a simple webhook handler without workflow orchestration.
 * Useful for simple endpoints that don't need step-based error handling.
 *
 * @example
 * ```typescript
 * const handler = createSimpleHandler({
 *   validateInput: (req) => {
 *     const { id } = req.params;
 *     if (!id) return err({ type: 'VALIDATION_ERROR', message: 'Missing id' });
 *     return ok({ id });
 *   },
 *   handler: async ({ id }) => {
 *     const user = await db.findUser(id);
 *     return user ? ok(user) : err('NOT_FOUND' as const);
 *   },
 *   mapResult: (result) => {
 *     if (result.ok) return { status: 200, body: result.value };
 *     return { status: 404, body: { error: { type: 'NOT_FOUND' } } };
 *   },
 * });
 * ```
 */
export function createSimpleHandler<TInput, TOutput, TError, TBody = unknown>(
  config: SimpleHandlerConfig<TInput, TOutput, TError, TBody>
): WebhookHandler<TBody> {
  const {
    validateInput,
    handler,
    mapResult,
    mapValidationError = defaultValidationErrorMapper,
    mapUnexpectedError = defaultUnexpectedErrorMapper,
  } = config;

  return async (req: WebhookRequest<TBody>): Promise<WebhookResponse> => {
    try {
      const validationResult = await validateInput(req);

      if (!isOk(validationResult)) {
        return mapValidationError(validationResult.error, req);
      }

      const result = await handler(validationResult.value, req);
      return mapResult(result, req);
    } catch (error) {
      return mapUnexpectedError(error, req);
    }
  };
}

// =============================================================================
// Result Mappers (Helpers)
// =============================================================================

/**
 * Standard error mapping configuration.
 */
export interface ErrorMapping<TError> {
  /** The error value to match */
  error: TError;
  /** HTTP status code for this error */
  status: number;
  /** Optional custom message */
  message?: string;
}

/**
 * Create a result mapper from error mappings.
 * Provides a declarative way to map workflow errors to HTTP responses.
 *
 * @param mappings - Array of error mappings
 * @param defaultStatus - Default status for unmapped errors (default: 500)
 * @returns A mapResult function for use in handler config
 *
 * @example
 * ```typescript
 * const mapResult = createResultMapper<CheckoutOutput, CheckoutError>([
 *   { error: 'NOT_FOUND', status: 404, message: 'Resource not found' },
 *   { error: 'CARD_DECLINED', status: 402, message: 'Payment failed' },
 *   { error: 'RATE_LIMITED', status: 429, message: 'Too many requests' },
 * ]);
 *
 * const handler = createWebhookHandler(workflow, workflowFn, {
 *   validateInput,
 *   mapResult,
 * });
 * ```
 */
export function createResultMapper<TOutput, TError>(
  mappings: ErrorMapping<TError>[],
  options: {
    defaultStatus?: number;
    successStatus?: number;
  } = {}
): (result: Result<TOutput, TError | UnexpectedError>) => WebhookResponse {
  const { defaultStatus = 500, successStatus = 200 } = options;

  const errorMap = new Map<TError, ErrorMapping<TError>>();
  for (const mapping of mappings) {
    errorMap.set(mapping.error, mapping);
  }

  return (result: Result<TOutput, TError | UnexpectedError>): WebhookResponse => {
    if (result.ok) {
      return {
        status: successStatus,
        body: result.value,
      };
    }

    // Check if it's an UnexpectedError
    if (
      typeof result.error === "object" &&
      result.error !== null &&
      (result.error as { type?: string }).type === "UNEXPECTED_ERROR"
    ) {
      return {
        status: 500,
        body: {
          error: {
            type: "INTERNAL_ERROR",
            message: "An unexpected error occurred",
          },
        },
      };
    }

    // Check error mappings
    const mapping = errorMap.get(result.error as TError);
    if (mapping) {
      return {
        status: mapping.status,
        body: {
          error: {
            type: String(mapping.error),
            message: mapping.message,
          },
        },
      };
    }

    // Default error response
    return {
      status: defaultStatus,
      body: {
        error: {
          type: String(result.error),
        },
      },
    };
  };
}

// =============================================================================
// Framework Adapters
// =============================================================================

/**
 * Express-style request object (minimal interface).
 */
export interface ExpressLikeRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
}

/**
 * Express-style response object (minimal interface).
 */
export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  set(headers: Record<string, string>): ExpressLikeResponse;
  json(body: unknown): void;
}

/**
 * Convert an Express-like request to WebhookRequest.
 *
 * @param req - Express-like request object
 * @returns WebhookRequest
 *
 * @example
 * ```typescript
 * app.post('/checkout', async (req, res) => {
 *   const webhookReq = toWebhookRequest(req);
 *   const response = await handler(webhookReq);
 *   res.status(response.status).json(response.body);
 * });
 * ```
 */
export function toWebhookRequest<TBody = unknown>(
  req: ExpressLikeRequest
): WebhookRequest<TBody> {
  return {
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body as TBody,
    query: req.query,
    params: req.params,
    raw: req,
  };
}

/**
 * Send a WebhookResponse using an Express-like response object.
 *
 * @param res - Express-like response object
 * @param response - WebhookResponse to send
 *
 * @example
 * ```typescript
 * app.post('/checkout', async (req, res) => {
 *   const response = await handler(toWebhookRequest(req));
 *   sendWebhookResponse(res, response);
 * });
 * ```
 */
export function sendWebhookResponse(
  res: ExpressLikeResponse,
  response: WebhookResponse
): void {
  if (response.headers) {
    res.set(response.headers);
  }
  res.status(response.status).json(response.body);
}

/**
 * Create an Express-compatible middleware from a webhook handler.
 *
 * @param handler - Webhook handler function
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * const handler = createWebhookHandler(workflow, workflowFn, config);
 * const middleware = createExpressHandler(handler);
 * app.post('/checkout', middleware);
 * ```
 */
export function createExpressHandler<TBody = unknown>(
  handler: WebhookHandler<TBody>
): (req: ExpressLikeRequest, res: ExpressLikeResponse) => Promise<void> {
  return async (req: ExpressLikeRequest, res: ExpressLikeResponse) => {
    const webhookReq = toWebhookRequest<TBody>(req);
    const response = await handler(webhookReq);
    sendWebhookResponse(res, response);
  };
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Create a validation error.
 *
 * @param message - Error message
 * @param field - Optional field name
 * @param details - Optional additional details
 * @returns ValidationError
 */
export function validationError(
  message: string,
  field?: string,
  details?: unknown
): ValidationError {
  return {
    type: "VALIDATION_ERROR",
    message,
    field,
    details,
  };
}

/**
 * Create a required field validator.
 *
 * @param fields - Field names to validate
 * @returns Validation function
 *
 * @example
 * ```typescript
 * const validateRequired = requireFields(['email', 'password']);
 *
 * const validateInput = (req) => {
 *   const result = validateRequired(req.body);
 *   if (!result.ok) return result;
 *   return ok(req.body as LoginInput);
 * };
 * ```
 */
export function requireFields(
  fields: string[]
): (body: Record<string, unknown>) => ValidationResult<void, ValidationError> {
  return (body: Record<string, unknown>) => {
    for (const field of fields) {
      if (body[field] === undefined || body[field] === null || body[field] === "") {
        return err(validationError(`Missing required field: ${field}`, field));
      }
    }
    return ok(undefined);
  };
}

/**
 * Compose multiple validators into a single validator.
 *
 * @param validators - Validators to compose
 * @returns Combined validator function
 *
 * @example
 * ```typescript
 * const validate = composeValidators(
 *   requireFields(['email', 'password']),
 *   validateEmailFormat,
 *   validatePasswordStrength
 * );
 * ```
 */
export function composeValidators<T>(
  ...validators: Array<(input: T) => ValidationResult<void, ValidationError>>
): (input: T) => ValidationResult<void, ValidationError> {
  return (input: T) => {
    for (const validator of validators) {
      const result = validator(input);
      if (!result.ok) return result;
    }
    return ok(undefined);
  };
}

// =============================================================================
// Event Trigger Types (for message queues, etc.)
// =============================================================================

/**
 * Generic event message for queue-based triggers.
 */
export interface EventMessage<T = unknown> {
  /** Unique message ID */
  id: string;
  /** Event type/name */
  type: string;
  /** Event payload */
  payload: T;
  /** Event metadata */
  metadata?: {
    timestamp?: number;
    source?: string;
    correlationId?: string;
    [key: string]: unknown;
  };
}

/**
 * Result of processing an event.
 */
export interface EventProcessingResult {
  /** Whether the event was processed successfully */
  success: boolean;
  /** Should the message be acknowledged (removed from queue)? */
  ack: boolean;
  /** Optional error details */
  error?: {
    type: string;
    message?: string;
    retryable?: boolean;
  };
}

/**
 * Configuration for event trigger handlers.
 */
export interface EventTriggerConfig<TPayload, TOutput, TError> {
  /** Validate the event payload */
  validatePayload: (
    event: EventMessage<TPayload>
  ) => ValidationResult<TPayload, ValidationError>;

  /** Map workflow result to processing result */
  mapResult: (
    result: Result<TOutput, TError | UnexpectedError>,
    event: EventMessage<TPayload>
  ) => EventProcessingResult;

  /** Optional: Determine if error is retryable */
  isRetryable?: (error: TError | UnexpectedError) => boolean;
}

/**
 * Event handler function type.
 */
export type EventHandler<TPayload = unknown> = (
  event: EventMessage<TPayload>
) => Promise<EventProcessingResult>;

/**
 * Create an event handler for queue-based triggers.
 *
 * @example
 * ```typescript
 * const handler = createEventHandler(
 *   checkoutWorkflow,
 *   async (step, deps, payload: CheckoutPayload) => {
 *     const charge = await step(() => deps.chargeCard(payload.amount));
 *     return { chargeId: charge.id };
 *   },
 *   {
 *     validatePayload: (event) => {
 *       if (!event.payload.amount) {
 *         return err({ type: 'VALIDATION_ERROR', message: 'Missing amount' });
 *       }
 *       return ok(event.payload);
 *     },
 *     mapResult: (result) => ({
 *       success: result.ok,
 *       ack: result.ok || !isRetryableError(result.error),
 *       error: result.ok ? undefined : { type: String(result.error) },
 *     }),
 *   }
 * );
 *
 * // Use with SQS, RabbitMQ, etc.
 * queue.consume(async (message) => {
 *   const result = await handler(message);
 *   if (result.ack) await message.ack();
 *   else await message.nack();
 * });
 * ```
 */
export function createEventHandler<
  TPayload,
  TOutput,
  TError,
  TDeps = unknown
>(
  workflow: Workflow<TError, TDeps> | WorkflowStrict<TError, unknown, TDeps>,
  workflowFn: (
    step: Parameters<Parameters<Workflow<TError, TDeps>>[1]>[0],
    deps: TDeps,
    payload: TPayload
  ) => TOutput | Promise<TOutput>,
  config: EventTriggerConfig<TPayload, TOutput, TError>
): EventHandler<TPayload> {
  const { validatePayload, mapResult } = config;

  return async (event: EventMessage<TPayload>): Promise<EventProcessingResult> => {
    try {
      const validationResult = validatePayload(event);

      if (!isOk(validationResult)) {
        return {
          success: false,
          ack: true, // Don't retry validation errors
          error: {
            type: validationResult.error.type,
            message: validationResult.error.message,
            retryable: false,
          },
        };
      }

      const workflowResult = await (workflow as Workflow<TError, TDeps>)(
        validationResult.value,
        (step, deps) => workflowFn(step, deps, validationResult.value)
      );

      return mapResult(workflowResult, event);
    } catch (error) {
      return {
        success: false,
        ack: false, // Retry unexpected errors
        error: {
          type: "UNEXPECTED_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      };
    }
  };
}
