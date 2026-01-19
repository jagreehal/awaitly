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
