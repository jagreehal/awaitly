import { describe, it, expect, vi } from "vitest";
import {
  createWebhookHandler,
  createSimpleHandler,
  createResultMapper,
  createEventHandler,
  toWebhookRequest,
  sendWebhookResponse,
  createExpressHandler,
  validationError,
  requireFields,
  composeValidators,
  isValidationError,
  defaultValidationErrorMapper,
  defaultUnexpectedErrorMapper,
  type WebhookRequest,
  type ValidationError,
  type EventMessage,
} from "./webhook";
import { createWorkflow, ok, err, type AsyncResult, type UnexpectedError } from "./index";

// =============================================================================
// Test Fixtures
// =============================================================================

// Simple workflow dependencies for testing
const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
  if (id === "1") return ok({ id: "1", name: "Alice" });
  return err("NOT_FOUND");
};

const chargeCard = async (
  amount: number
): AsyncResult<{ transactionId: string }, "CARD_DECLINED" | "INSUFFICIENT_FUNDS"> => {
  if (amount > 10000) return err("CARD_DECLINED");
  if (amount > 5000) return err("INSUFFICIENT_FUNDS");
  return ok({ transactionId: `tx_${amount}` });
};

// Define deps type
type TestDeps = typeof testDeps;
const testDeps = { fetchUser, chargeCard };

// Create test workflow
const testWorkflow = createWorkflow(testDeps);

// Helper to create mock requests
const mockRequest = <T>(overrides: Partial<WebhookRequest<T>> = {}): WebhookRequest<T> => ({
  method: "POST",
  path: "/api/test",
  headers: {},
  body: {} as T,
  query: {},
  params: {},
  ...overrides,
});

// =============================================================================
// Validation Helpers Tests
// =============================================================================

describe("Validation Helpers", () => {
  describe("validationError", () => {
    it("creates validation error with message", () => {
      const error = validationError("Missing field");
      expect(error).toEqual({
        type: "VALIDATION_ERROR",
        message: "Missing field",
        field: undefined,
        details: undefined,
      });
    });

    it("creates validation error with field", () => {
      const error = validationError("Invalid email", "email");
      expect(error).toEqual({
        type: "VALIDATION_ERROR",
        message: "Invalid email",
        field: "email",
        details: undefined,
      });
    });

    it("creates validation error with details", () => {
      const error = validationError("Invalid", "field", { min: 5 });
      expect(error).toEqual({
        type: "VALIDATION_ERROR",
        message: "Invalid",
        field: "field",
        details: { min: 5 },
      });
    });
  });

  describe("isValidationError", () => {
    it("returns true for validation errors", () => {
      const error: ValidationError = {
        type: "VALIDATION_ERROR",
        message: "test",
      };
      expect(isValidationError(error)).toBe(true);
    });

    it("returns false for other objects", () => {
      expect(isValidationError({ type: "OTHER" })).toBe(false);
      expect(isValidationError(null)).toBe(false);
      expect(isValidationError("string")).toBe(false);
    });
  });

  describe("requireFields", () => {
    it("validates required fields present", () => {
      const validator = requireFields(["email", "password"]);
      const result = validator({ email: "test@example.com", password: "secret" });
      expect(result.ok).toBe(true);
    });

    it("rejects missing fields", () => {
      const validator = requireFields(["email", "password"]);
      const result = validator({ email: "test@example.com" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe("password");
      }
    });

    it("rejects null fields", () => {
      const validator = requireFields(["email"]);
      const result = validator({ email: null });
      expect(result.ok).toBe(false);
    });

    it("rejects empty string fields", () => {
      const validator = requireFields(["email"]);
      const result = validator({ email: "" });
      expect(result.ok).toBe(false);
    });
  });

  describe("composeValidators", () => {
    it("runs all validators in sequence", () => {
      const v1 = requireFields(["email"]);
      const v2 = requireFields(["password"]);
      const composed = composeValidators(v1, v2);

      const result = composed({ email: "test@example.com", password: "secret" });
      expect(result.ok).toBe(true);
    });

    it("returns first failure", () => {
      const v1 = requireFields(["email"]);
      const v2 = requireFields(["password"]);
      const composed = composeValidators(v1, v2);

      const result = composed({ password: "secret" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe("email");
      }
    });
  });
});

// =============================================================================
// Default Mappers Tests
// =============================================================================

describe("Default Mappers", () => {
  describe("defaultValidationErrorMapper", () => {
    it("returns 400 with error details", () => {
      const error: ValidationError = {
        type: "VALIDATION_ERROR",
        message: "Invalid email",
        field: "email",
      };

      const response = defaultValidationErrorMapper(error);

      expect(response.status).toBe(400);
      expect(response.body.error.type).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid email");
      expect(response.body.error.details).toEqual({ field: "email" });
    });

    it("uses details when field not present", () => {
      const error: ValidationError = {
        type: "VALIDATION_ERROR",
        message: "Invalid",
        details: { min: 5 },
      };

      const response = defaultValidationErrorMapper(error);
      expect(response.body.error.details).toEqual({ min: 5 });
    });
  });

  describe("defaultUnexpectedErrorMapper", () => {
    it("returns 500 with generic message", () => {
      const response = defaultUnexpectedErrorMapper(new Error("boom"));

      expect(response.status).toBe(500);
      expect(response.body.error.type).toBe("INTERNAL_ERROR");
      expect(response.body.error.message).toBe("An unexpected error occurred");
    });
  });
});

// =============================================================================
// createResultMapper Tests
// =============================================================================

describe("createResultMapper", () => {
  it("maps success to 200", () => {
    const mapper = createResultMapper<{ id: string }, "NOT_FOUND">([]);

    const result = mapper(ok({ id: "123" }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: "123" });
  });

  it("maps success with custom status", () => {
    const mapper = createResultMapper<{ id: string }, "NOT_FOUND">([], {
      successStatus: 201,
    });

    const result = mapper(ok({ id: "123" }));
    expect(result.status).toBe(201);
  });

  it("maps known errors", () => {
    const mapper = createResultMapper<{ id: string }, "NOT_FOUND" | "FORBIDDEN">([
      { error: "NOT_FOUND", status: 404, message: "Resource not found" },
      { error: "FORBIDDEN", status: 403, message: "Access denied" },
    ]);

    const result = mapper(err("NOT_FOUND"));

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: {
        type: "NOT_FOUND",
        message: "Resource not found",
      },
    });
  });

  it("maps unknown errors to default status", () => {
    const mapper = createResultMapper<{ id: string }, "NOT_FOUND" | "OTHER">([
      { error: "NOT_FOUND", status: 404 },
    ]);

    const result = mapper(err("OTHER"));

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: {
        type: "OTHER",
      },
    });
  });

  it("maps unexpected errors to 500", () => {
    type TestError = "NOT_FOUND" | UnexpectedError;
    const mapper = createResultMapper<{ id: string }, TestError>([]);

    const unexpectedErr: UnexpectedError = {
      type: "UNEXPECTED_ERROR",
      cause: { type: "UNCAUGHT_EXCEPTION", thrown: new Error("boom") },
    };
    const result = mapper(err(unexpectedErr));

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: {
        type: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });

  it("uses custom default status", () => {
    const mapper = createResultMapper<{ id: string }, "UNKNOWN">([], {
      defaultStatus: 400,
    });

    const result = mapper(err("UNKNOWN"));
    expect(result.status).toBe(400);
  });
});

// =============================================================================
// createWebhookHandler Tests
// =============================================================================

describe("createWebhookHandler", () => {
  it("executes workflow with validated input", async () => {
    type Input = { userId: string };
    type Body = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createWebhookHandler<Input, { id: string; name: string }, WorkflowError, Body, TestDeps>(
      testWorkflow,
      async (step, deps, input) => {
        return await step(() => deps.fetchUser(input.userId));
      },
      {
        validateInput: (req) => {
          if (!req.body.userId) {
            return err(validationError("Missing userId", "userId"));
          }
          return ok({ userId: req.body.userId });
        },
        mapResult: (result) => {
          if (result.ok) {
            return { status: 200, body: result.value };
          }
          return { status: 404, body: { error: { type: "NOT_FOUND" } } };
        },
      }
    );

    const response = await handler(mockRequest<Body>({ body: { userId: "1" } }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "1", name: "Alice" });
  });

  it("returns validation error for invalid input", async () => {
    type Input = { userId: string };
    type Body = { userId?: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createWebhookHandler<Input, unknown, WorkflowError, Body, TestDeps>(
      testWorkflow,
      async () => ({}),
      {
        validateInput: (req) => {
          if (!req.body.userId) {
            return err(validationError("Missing userId", "userId"));
          }
          return ok({ userId: req.body.userId });
        },
        mapResult: () => ({ status: 200, body: {} }),
      }
    );

    const response = await handler(mockRequest<Body>({ body: {} }));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        type: "VALIDATION_ERROR",
        message: "Missing userId",
        details: { field: "userId" },
      },
    });
  });

  it("handles workflow errors", async () => {
    type Input = { userId: string };
    type Body = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createWebhookHandler<Input, { id: string; name: string }, WorkflowError, Body, TestDeps>(
      testWorkflow,
      async (step, deps, input) => {
        return await step(() => deps.fetchUser(input.userId));
      },
      {
        validateInput: (req) => ok({ userId: req.body.userId }),
        mapResult: (result) => {
          if (result.ok) {
            return { status: 200, body: result.value };
          }
          if (result.error === "NOT_FOUND") {
            return { status: 404, body: { error: { type: "NOT_FOUND" } } };
          }
          return { status: 500, body: { error: { type: "UNKNOWN" } } };
        },
      }
    );

    const response = await handler(mockRequest<Body>({ body: { userId: "999" } }));

    expect(response.status).toBe(404);
  });

  it("applies beforeValidation middleware", async () => {
    type Body = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createWebhookHandler<{ userId: string }, unknown, WorkflowError, Body, TestDeps>(
      testWorkflow,
      async () => ({}),
      {
        beforeValidation: (req) => ({
          ...req,
          body: { ...req.body, userId: req.body.userId.toUpperCase() },
        }),
        validateInput: (req) => ok({ userId: req.body.userId }),
        mapResult: (result, req) => {
          // Access the transformed request
          return { status: 200, body: { userId: (req.body as Body).userId } };
        },
      }
    );

    const response = await handler(mockRequest<Body>({ body: { userId: "abc" } }));

    expect(response.body).toEqual({ userId: "ABC" });
  });

  it("applies afterResponse middleware", async () => {
    type Body = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createWebhookHandler<{ userId: string }, unknown, WorkflowError, Body, TestDeps>(
      testWorkflow,
      async () => ({}),
      {
        validateInput: (req) => ok({ userId: req.body.userId }),
        mapResult: () => ({ status: 200, body: { message: "ok" } }),
        afterResponse: (response) => ({
          ...response,
          headers: { "X-Custom-Header": "value" },
        }),
      }
    );

    const response = await handler(mockRequest<Body>({ body: { userId: "1" } }));

    expect(response.headers).toEqual({ "X-Custom-Header": "value" });
  });

  it("handles unexpected errors during processing", async () => {
    // When a throw happens inside the workflow function, it's caught by the workflow
    // and returned as an UnexpectedError through mapResult - not as an exception.
    // This tests that mapResult properly handles UnexpectedError types.
    type Body = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createWebhookHandler<{ userId: string }, unknown, WorkflowError, Body, TestDeps>(
      testWorkflow,
      async () => {
        throw new Error("Unexpected failure");
      },
      {
        validateInput: (req) => ok({ userId: req.body.userId }),
        mapResult: (result) => {
          // The workflow catches the throw and returns it as UnexpectedError
          if (result.ok) {
            return { status: 200, body: {} };
          }
          // Check for UnexpectedError type
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
          return { status: 400, body: { error: { type: "UNKNOWN" } } };
        },
      }
    );

    const response = await handler(mockRequest<Body>({ body: { userId: "1" } }));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        type: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });

  it("uses mapUnexpectedError for validation/processing errors outside workflow", async () => {
    // mapUnexpectedError is for errors that happen OUTSIDE the workflow
    // (e.g., in beforeValidation, afterResponse, or validation itself throwing)
    type Body = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createWebhookHandler<{ userId: string }, unknown, WorkflowError, Body, TestDeps>(
      testWorkflow,
      async () => ({}),
      {
        validateInput: () => {
          // This throws outside the workflow, so mapUnexpectedError handles it
          throw new Error("Validation crashed");
        },
        mapResult: () => ({ status: 200, body: {} }),
        mapUnexpectedError: (error) => ({
          status: 503,
          body: {
            error: {
              type: "SERVICE_UNAVAILABLE",
              message: error instanceof Error ? error.message : "Unknown",
            },
          },
        }),
      }
    );

    const response = await handler(mockRequest<Body>({ body: { userId: "1" } }));

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        type: "SERVICE_UNAVAILABLE",
        message: "Validation crashed",
      },
    });
  });
});

// =============================================================================
// createSimpleHandler Tests
// =============================================================================

describe("createSimpleHandler", () => {
  it("handles simple request-response flow", async () => {
    type Input = { id: string };
    type Body = { id: string };

    const handler = createSimpleHandler<Input, { id: string; name: string }, "NOT_FOUND", Body>({
      validateInput: (req) => {
        if (!req.body.id) return err(validationError("Missing id"));
        return ok({ id: req.body.id });
      },
      handler: async (input) => {
        if (input.id === "1") return ok({ id: "1", name: "Alice" });
        return err("NOT_FOUND");
      },
      mapResult: (result) => {
        if (result.ok) return { status: 200, body: result.value };
        return { status: 404, body: { error: { type: "NOT_FOUND" } } };
      },
    });

    const response = await handler(mockRequest<Body>({ body: { id: "1" } }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "1", name: "Alice" });
  });

  it("handles errors", async () => {
    type Body = { id: string };

    const handler = createSimpleHandler<{ id: string }, unknown, "NOT_FOUND", Body>({
      validateInput: (req) => ok({ id: req.body.id }),
      handler: async () => err("NOT_FOUND"),
      mapResult: (result) => {
        if (result.ok) return { status: 200, body: {} };
        return { status: 404, body: { error: { type: "NOT_FOUND" } } };
      },
    });

    const response = await handler(mockRequest<Body>({ body: { id: "999" } }));

    expect(response.status).toBe(404);
  });
});

// =============================================================================
// createEventHandler Tests
// =============================================================================

describe("createEventHandler", () => {
  it("processes valid events", async () => {
    type Payload = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createEventHandler<Payload, { id: string; name: string }, WorkflowError, TestDeps>(
      testWorkflow,
      async (step, deps, payload) => {
        return await step(() => deps.fetchUser(payload.userId));
      },
      {
        validatePayload: (event) => {
          if (!event.payload.userId) {
            return err(validationError("Missing userId"));
          }
          return ok(event.payload);
        },
        mapResult: (result) => ({
          success: result.ok,
          ack: true,
          error: result.ok ? undefined : { type: String(result.error) },
        }),
      }
    );

    const event: EventMessage<Payload> = {
      id: "evt_1",
      type: "user.fetch",
      payload: { userId: "1" },
    };

    const result = await handler(event);

    expect(result.success).toBe(true);
    expect(result.ack).toBe(true);
  });

  it("rejects invalid events with ack=true", async () => {
    type Payload = { userId?: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createEventHandler<Payload, unknown, WorkflowError, TestDeps>(
      testWorkflow,
      async () => ({}),
      {
        validatePayload: (event) => {
          if (!event.payload.userId) {
            return err(validationError("Missing userId"));
          }
          return ok(event.payload as Payload);
        },
        mapResult: () => ({ success: true, ack: true }),
      }
    );

    const event: EventMessage<Payload> = {
      id: "evt_1",
      type: "user.fetch",
      payload: {},
    };

    const result = await handler(event);

    expect(result.success).toBe(false);
    expect(result.ack).toBe(true); // Don't retry validation errors
    expect(result.error?.type).toBe("VALIDATION_ERROR");
    expect(result.error?.retryable).toBe(false);
  });

  it("handles workflow errors", async () => {
    type Payload = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createEventHandler<Payload, { id: string; name: string }, WorkflowError, TestDeps>(
      testWorkflow,
      async (step, deps, payload) => {
        return await step(() => deps.fetchUser(payload.userId));
      },
      {
        validatePayload: (event) => ok(event.payload),
        mapResult: (result) => ({
          success: result.ok,
          ack: result.ok,
          error: result.ok ? undefined : { type: String(result.error), retryable: true },
        }),
      }
    );

    const event: EventMessage<Payload> = {
      id: "evt_1",
      type: "user.fetch",
      payload: { userId: "999" },
    };

    const result = await handler(event);

    expect(result.success).toBe(false);
    expect(result.ack).toBe(false);
    expect(result.error?.type).toBe("NOT_FOUND");
  });

  it("handles unexpected errors with retry", async () => {
    // When a throw happens inside the workflow, it's caught by the workflow
    // and returned as an UnexpectedError through mapResult
    type Payload = { userId: string };
    type WorkflowError = "NOT_FOUND" | "CARD_DECLINED" | "INSUFFICIENT_FUNDS";

    const handler = createEventHandler<Payload, unknown, WorkflowError, TestDeps>(
      testWorkflow,
      async () => {
        throw new Error("Connection failed");
      },
      {
        validatePayload: (event) => ok(event.payload),
        mapResult: (result) => {
          if (result.ok) {
            return { success: true, ack: true };
          }
          // Check for UnexpectedError type
          const isUnexpected =
            typeof result.error === "object" &&
            result.error !== null &&
            (result.error as { type?: string }).type === "UNEXPECTED_ERROR";

          return {
            success: false,
            ack: !isUnexpected, // Don't ack unexpected errors (retry them)
            error: {
              type: isUnexpected ? "UNEXPECTED_ERROR" : String(result.error),
              retryable: isUnexpected,
            },
          };
        },
      }
    );

    const event: EventMessage<Payload> = {
      id: "evt_1",
      type: "test",
      payload: { userId: "1" },
    };

    const result = await handler(event);

    expect(result.success).toBe(false);
    expect(result.ack).toBe(false); // Retry unexpected errors
    expect(result.error?.type).toBe("UNEXPECTED_ERROR");
    expect(result.error?.retryable).toBe(true);
  });
});

// =============================================================================
// Framework Adapter Tests
// =============================================================================

describe("Framework Adapters", () => {
  describe("toWebhookRequest", () => {
    it("converts Express-like request to WebhookRequest", () => {
      const expressReq = {
        method: "POST",
        path: "/api/users",
        headers: { "content-type": "application/json" },
        body: { name: "Alice" },
        query: { limit: "10" },
        params: { id: "123" },
      };

      const webhookReq = toWebhookRequest(expressReq);

      expect(webhookReq.method).toBe("POST");
      expect(webhookReq.path).toBe("/api/users");
      expect(webhookReq.headers).toEqual({ "content-type": "application/json" });
      expect(webhookReq.body).toEqual({ name: "Alice" });
      expect(webhookReq.query).toEqual({ limit: "10" });
      expect(webhookReq.params).toEqual({ id: "123" });
      expect(webhookReq.raw).toBe(expressReq);
    });
  });

  describe("sendWebhookResponse", () => {
    it("sends response with status and body", () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      sendWebhookResponse(mockRes, {
        status: 200,
        body: { message: "ok" },
      });

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ message: "ok" });
    });

    it("sets headers when provided", () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      sendWebhookResponse(mockRes, {
        status: 200,
        headers: { "X-Custom": "value" },
        body: {},
      });

      expect(mockRes.set).toHaveBeenCalledWith({ "X-Custom": "value" });
    });
  });

  describe("createExpressHandler", () => {
    it("creates Express middleware from webhook handler", async () => {
      type Body = { userId: string };

      const webhookHandler = createSimpleHandler<{ userId: string }, { id: string }, string, Body>({
        validateInput: (req) => ok({ userId: req.body.userId }),
        handler: async (input) => ok({ id: input.userId }),
        mapResult: (result) =>
          result.ok
            ? { status: 200, body: result.value }
            : { status: 500, body: { error: { type: "ERROR" } } },
      });

      const expressMiddleware = createExpressHandler(webhookHandler);

      const mockReq = {
        method: "POST",
        path: "/test",
        headers: {},
        body: { userId: "123" },
        query: {},
        params: {},
      };

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await expressMiddleware(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ id: "123" });
    });
  });
});
