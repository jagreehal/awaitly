---
title: Webhooks & Events
description: Expose workflows as HTTP endpoints or event consumers
---

Expose workflows as HTTP endpoints or event consumers with built-in validation and error mapping.

## Webhook handler

Create HTTP handlers for workflows:

```typescript
import { ok } from 'awaitly';
import {
  createWebhookHandler,
  createResultMapper,
  createExpressHandler,
  requireFields,
} from 'awaitly/webhook';

// Create a webhook handler
const handler = createWebhookHandler(
  checkoutWorkflow,
  async (step, deps, input: CheckoutInput) => {
    const charge = await step(() => deps.chargeCard(input.amount));
    await step(() => deps.sendEmail(input.email, charge.receiptUrl));
    return { chargeId: charge.id };
  },
  {
    validateInput: (req) => {
      const validation = requireFields(['amount', 'email'])(req.body);
      if (!validation.ok) return validation;
      return ok({ amount: req.body.amount, email: req.body.email });
    },
    mapResult: createResultMapper([
      { error: 'CARD_DECLINED', status: 402, message: 'Payment failed' },
      { error: 'INVALID_EMAIL', status: 400, message: 'Invalid email address' },
    ]),
  }
);
```

## With Express

```typescript
import express from 'express';
import { createExpressHandler } from 'awaitly/webhook';

const app = express();
app.use(express.json());

// Use the built-in adapter
app.post('/checkout', createExpressHandler(handler));

// Or handle manually
app.post('/checkout', async (req, res) => {
  const response = await handler({
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body,
    query: req.query,
    params: req.params,
  });
  res.status(response.status).json(response.body);
});
```

## Input validation

Use built-in validators or write your own:

```typescript
import { ok, err } from 'awaitly';
import { requireFields, validationError } from 'awaitly/webhook';

// Built-in field checker
const validate = requireFields(['amount', 'email', 'items']);

// Custom validation
const validateInput = (req) => {
  if (!req.body.amount || req.body.amount <= 0) {
    return err(validationError('Amount must be positive'));
  }
  if (!req.body.email?.includes('@')) {
    return err(validationError('Invalid email format'));
  }
  return ok({
    amount: req.body.amount,
    email: req.body.email,
  });
};
```

## Result mapping

Map workflow errors to HTTP responses:

```typescript
import { createResultMapper } from 'awaitly/webhook';

const mapResult = createResultMapper([
  { error: 'NOT_FOUND', status: 404, message: 'Resource not found' },
  { error: 'UNAUTHORIZED', status: 401, message: 'Authentication required' },
  { error: 'FORBIDDEN', status: 403, message: 'Access denied' },
  { error: 'VALIDATION_ERROR', status: 400, message: 'Invalid input' },
  { error: 'CARD_DECLINED', status: 402, message: 'Payment declined' },
  // Unmapped errors return 500 with generic message
]);
```

## Event handlers

For message queues (SQS, RabbitMQ, etc.):

```typescript
import { createEventHandler } from 'awaitly/webhook';

const handler = createEventHandler(
  checkoutWorkflow,
  async (step, deps, payload: CheckoutPayload) => {
    const charge = await step(() => deps.chargeCard(payload.amount));
    return { chargeId: charge.id };
  },
  {
    validatePayload: (event) => {
      if (!event.payload.amount) {
        return err(validationError('Missing amount'));
      }
      return ok(event.payload);
    },
    mapResult: (result) => ({
      success: result.ok,
      ack: result.ok || !isRetryableError(result.error),
      error: result.ok ? undefined : { type: String(result.error) },
    }),
  }
);

// Use with SQS, RabbitMQ, etc.
queue.consume(async (message) => {
  const result = await handler({
    id: message.id,
    type: message.type,
    payload: message.body,
  });
  if (result.ack) await message.ack();
  else await message.nack();
});
```

## Simple handlers

For straightforward use cases without workflow context:

```typescript
import { ok } from 'awaitly';
import { createSimpleHandler } from 'awaitly/webhook';

const handler = createSimpleHandler(
  async (input: { userId: string }) => {
    const user = await db.users.find(input.userId);
    if (!user) return err('NOT_FOUND' as const);
    return ok(user);
  },
  {
    validateInput: (req) => {
      if (!req.params.userId) {
        return err(validationError('Missing userId'));
      }
      return ok({ userId: req.params.userId });
    },
  }
);
```

## Request/response types

### WebhookRequest

```typescript
interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[]>;
  body: unknown;
  query: Record<string, string>;
  params: Record<string, string>;
}
```

### WebhookResponse

```typescript
interface WebhookResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}
```

### EventRequest

```typescript
interface EventRequest<T> {
  id: string;
  type: string;
  payload: T;
  metadata?: Record<string, unknown>;
}
```

### EventResponse

```typescript
interface EventResponse {
  success: boolean;
  ack: boolean;  // Whether to acknowledge the message
  error?: { type: string; message?: string };
}
```

## Error handling patterns

```typescript
// Determine if error is retryable
const isRetryableError = (error: unknown): boolean => {
  const retryable = ['TIMEOUT', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED'];
  return typeof error === 'string' && retryable.includes(error);
};

// Custom result mapper with retry logic
const mapResult = (result) => ({
  success: result.ok,
  ack: result.ok || !isRetryableError(result.error),
  error: result.ok ? undefined : {
    type: String(result.error),
    retryable: isRetryableError(result.error),
  },
});
```

## Framework Adapters

### Fastify

```typescript
import Fastify from 'fastify';
import { createWebhookHandler, createResultMapper } from 'awaitly/webhook';

const fastify = Fastify();

const handler = createWebhookHandler(
  checkoutWorkflow,
  async (step, deps, input: CheckoutInput) => {
    const charge = await step(() => deps.chargeCard(input.amount));
    return { chargeId: charge.id };
  },
  {
    validateInput: (req) => {
      if (!req.body.amount) return err(validationError('Missing amount'));
      return ok({ amount: req.body.amount, email: req.body.email });
    },
    mapResult: createResultMapper([
      { error: 'CARD_DECLINED', status: 402, message: 'Payment failed' },
    ]),
  }
);

// Fastify route
fastify.post('/checkout', async (request, reply) => {
  const response = await handler({
    method: request.method,
    path: request.url,
    headers: request.headers as Record<string, string>,
    body: request.body,
    query: request.query as Record<string, string>,
    params: request.params as Record<string, string>,
  });

  return reply.status(response.status).send(response.body);
});

// Or create a reusable adapter
const createFastifyHandler = (webhookHandler: typeof handler) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const response = await webhookHandler({
      method: request.method,
      path: request.url,
      headers: request.headers as Record<string, string>,
      body: request.body,
      query: request.query as Record<string, string>,
      params: request.params as Record<string, string>,
    });
    return reply.status(response.status).send(response.body);
  };
};

fastify.post('/checkout', createFastifyHandler(handler));
```

### Hono

```typescript
import { Hono } from 'hono';
import { createWebhookHandler, createResultMapper } from 'awaitly/webhook';

const app = new Hono();

const handler = createWebhookHandler(
  orderWorkflow,
  async (step, deps, input: OrderInput) => {
    const order = await step(() => deps.createOrder(input));
    return { orderId: order.id };
  },
  {
    validateInput: (req) => {
      if (!req.body.items?.length) {
        return err(validationError('Order must have items'));
      }
      return ok(req.body);
    },
    mapResult: createResultMapper([
      { error: 'OUT_OF_STOCK', status: 409, message: 'Item out of stock' },
      { error: 'INVALID_COUPON', status: 400, message: 'Invalid coupon code' },
    ]),
  }
);

// Hono route
app.post('/orders', async (c) => {
  const body = await c.req.json();

  const response = await handler({
    method: c.req.method,
    path: c.req.path,
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    body,
    query: c.req.query(),
    params: c.req.param(),
  });

  return c.json(response.body, response.status);
});

// Reusable Hono adapter
const createHonoHandler = (webhookHandler: typeof handler) => {
  return async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));

    const response = await webhookHandler({
      method: c.req.method,
      path: c.req.path,
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      body,
      query: c.req.query(),
      params: c.req.param(),
    });

    return c.json(response.body, response.status);
  };
};

app.post('/orders', createHonoHandler(handler));
```

### Next.js App Router

```typescript
// app/api/checkout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createWebhookHandler, createResultMapper } from 'awaitly/webhook';

const handler = createWebhookHandler(
  checkoutWorkflow,
  async (step, deps, input: CheckoutInput) => {
    const charge = await step(() => deps.chargeCard(input.amount));
    return { chargeId: charge.id };
  },
  {
    validateInput: (req) => {
      if (!req.body.amount) return err(validationError('Missing amount'));
      return ok(req.body);
    },
    mapResult: createResultMapper([
      { error: 'CARD_DECLINED', status: 402, message: 'Payment failed' },
    ]),
  }
);

export async function POST(request: NextRequest) {
  const body = await request.json();
  const url = new URL(request.url);

  const response = await handler({
    method: request.method,
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    query: Object.fromEntries(url.searchParams.entries()),
    params: {},
  });

  return NextResponse.json(response.body, { status: response.status });
}
```

## Authentication Patterns

### API Key authentication

```typescript
import { ok, err } from 'awaitly';
import { createWebhookHandler, validationError } from 'awaitly/webhook';

const authenticateApiKey = (req: WebhookRequest) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return err(validationError('Missing API key'));
  }

  // Validate against your API key store
  const client = apiKeys.get(apiKey);
  if (!client) {
    return err(validationError('Invalid API key'));
  }

  return ok(client);
};

const handler = createWebhookHandler(
  orderWorkflow,
  async (step, deps, input: OrderInput) => {
    // input now includes authenticated client
    const order = await step(() => deps.createOrder(input.order, input.client));
    return { orderId: order.id };
  },
  {
    validateInput: async (req) => {
      // Authenticate first
      const authResult = authenticateApiKey(req);
      if (!authResult.ok) return authResult;

      // Then validate body
      if (!req.body.items?.length) {
        return err(validationError('Order must have items'));
      }

      return ok({
        client: authResult.value,
        order: req.body,
      });
    },
    mapResult: createResultMapper([
      { error: 'UNAUTHORIZED', status: 401, message: 'Invalid API key' },
      { error: 'FORBIDDEN', status: 403, message: 'Access denied' },
    ]),
  }
);
```

### JWT authentication

```typescript
import jwt from 'jsonwebtoken';

const authenticateJwt = (req: WebhookRequest) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    return err(validationError('Missing or invalid authorization header'));
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      role: string;
    };
    return ok(decoded);
  } catch (error) {
    return err(validationError('Invalid or expired token'));
  }
};

const handler = createWebhookHandler(
  profileWorkflow,
  async (step, deps, input) => {
    // Access user from validated input
    const profile = await step(() => deps.getProfile(input.user.userId));
    return profile;
  },
  {
    validateInput: async (req) => {
      const authResult = authenticateJwt(req);
      if (!authResult.ok) return authResult;

      return ok({
        user: authResult.value,
        ...req.body,
      });
    },
    mapResult: createResultMapper([
      { error: 'UNAUTHORIZED', status: 401, message: 'Authentication required' },
    ]),
  }
);
```

### Webhook signature verification (e.g., Stripe)

```typescript
import Stripe from 'stripe';

const verifyStripeWebhook = (req: WebhookRequest) => {
  const signature = req.headers['stripe-signature'];
  const rawBody = req.body; // Must be raw body, not parsed JSON

  if (!signature) {
    return err(validationError('Missing webhook signature'));
  }

  try {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
    return ok(event);
  } catch (error) {
    return err(validationError('Invalid webhook signature'));
  }
};

const stripeWebhookHandler = createWebhookHandler(
  paymentEventWorkflow,
  async (step, deps, event: Stripe.Event) => {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await step(() => deps.fulfillOrder(event.data.object.id));
        break;
      case 'payment_intent.payment_failed':
        await step(() => deps.notifyPaymentFailed(event.data.object.id));
        break;
    }
    return { received: true };
  },
  {
    validateInput: verifyStripeWebhook,
    mapResult: () => ({ status: 200, body: { received: true } }),
  }
);
```

## Advanced Validation Patterns

### Schema validation with Zod

```typescript
import { z } from 'zod';
import { ok, err } from 'awaitly';
import { validationError } from 'awaitly/webhook';

const CheckoutSchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(['usd', 'eur', 'gbp']),
  email: z.string().email(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
  })).min(1),
});

const validateWithZod = <T>(schema: z.ZodSchema<T>) => {
  return (req: WebhookRequest) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const firstError = result.error.errors[0];
      return err(validationError(
        `${firstError.path.join('.')}: ${firstError.message}`
      ));
    }

    return ok(result.data);
  };
};

const handler = createWebhookHandler(
  checkoutWorkflow,
  async (step, deps, input) => {
    const charge = await step(() => deps.chargeCard(input));
    return { chargeId: charge.id };
  },
  {
    validateInput: validateWithZod(CheckoutSchema),
    mapResult: createResultMapper([
      { error: 'CARD_DECLINED', status: 402, message: 'Payment failed' },
    ]),
  }
);
```

### Composable validators

```typescript
import { ok, err } from 'awaitly';

type Validator<T> = (req: WebhookRequest) => Result<T, ValidationError>;

// Compose multiple validators
const composeValidators = <T>(
  ...validators: Validator<Partial<T>>[]
): Validator<T> => {
  return (req) => {
    let accumulated: Partial<T> = {};

    for (const validator of validators) {
      const result = validator(req);
      if (!result.ok) return result;
      accumulated = { ...accumulated, ...result.value };
    }

    return ok(accumulated as T);
  };
};

// Individual validators
const validateAuth: Validator<{ userId: string }> = (req) => {
  const token = req.headers['authorization'];
  if (!token) return err(validationError('Missing auth'));
  // ... verify token
  return ok({ userId: 'user123' });
};

const validateBody: Validator<{ amount: number }> = (req) => {
  if (typeof req.body.amount !== 'number') {
    return err(validationError('Amount must be a number'));
  }
  return ok({ amount: req.body.amount });
};

// Composed validator
const validateRequest = composeValidators(validateAuth, validateBody);

const handler = createWebhookHandler(
  workflow,
  async (step, deps, input) => {
    // input has type { userId: string; amount: number }
    return await step(() => deps.process(input));
  },
  { validateInput: validateRequest }
);
```

### Rate limiting in validation

```typescript
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

const withRateLimit = <T>(
  validator: Validator<T>,
  { maxRequests = 100, windowMs = 60000 } = {}
): Validator<T> => {
  return (req) => {
    const clientIp = req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();

    const entry = rateLimiter.get(clientIp);

    if (entry && now < entry.resetAt) {
      if (entry.count >= maxRequests) {
        return err(validationError('Rate limit exceeded'));
      }
      entry.count++;
    } else {
      rateLimiter.set(clientIp, { count: 1, resetAt: now + windowMs });
    }

    return validator(req);
  };
};

const handler = createWebhookHandler(
  workflow,
  async (step, deps, input) => {
    return await step(() => deps.process(input));
  },
  {
    validateInput: withRateLimit(
      validateWithZod(RequestSchema),
      { maxRequests: 10, windowMs: 60000 }
    ),
    mapResult: createResultMapper([
      { error: 'RATE_LIMITED', status: 429, message: 'Too many requests' },
    ]),
  }
);
```

## Testing Webhook Handlers

```typescript
import { describe, it, expect } from 'vitest';

describe('checkout webhook', () => {
  it('processes valid checkout', async () => {
    const response = await handler({
      method: 'POST',
      path: '/checkout',
      headers: { 'content-type': 'application/json' },
      body: { amount: 1000, email: 'test@example.com' },
      query: {},
      params: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('chargeId');
  });

  it('returns 400 for missing amount', async () => {
    const response = await handler({
      method: 'POST',
      path: '/checkout',
      headers: { 'content-type': 'application/json' },
      body: { email: 'test@example.com' },
      query: {},
      params: {},
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('amount');
  });

  it('returns 402 for declined card', async () => {
    // Mock the workflow to return CARD_DECLINED
    const mockHandler = createWebhookHandler(
      mockWorkflow, // returns err('CARD_DECLINED')
      async () => { /* ... */ },
      {
        validateInput: (req) => ok(req.body),
        mapResult: createResultMapper([
          { error: 'CARD_DECLINED', status: 402, message: 'Payment failed' },
        ]),
      }
    );

    const response = await mockHandler({
      method: 'POST',
      path: '/checkout',
      headers: {},
      body: { amount: 1000 },
      query: {},
      params: {},
    });

    expect(response.status).toBe(402);
  });
});
```

## Next

[Learn about Circuit Breakers →](../circuit-breaker/)
