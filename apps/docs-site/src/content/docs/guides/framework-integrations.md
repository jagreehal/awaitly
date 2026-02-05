---
title: Framework Integrations
description: Use awaitly with Next.js, Express, Fastify, and more
---

Integrate awaitly workflows into popular frameworks with practical patterns.

## Next.js (App Router)

### Server Action with checkout flow

```typescript
// app/actions/checkout.ts
'use server';

import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

// Define your operations
const fetchCart = async (userId: string): AsyncResult<Cart, 'CART_NOT_FOUND'> => {
  const cart = await db.carts.findUnique({ where: { userId } });
  return cart ? ok(cart) : err('CART_NOT_FOUND');
};

const validateStock = async (items: CartItem[]): AsyncResult<void, 'OUT_OF_STOCK'> => {
  const outOfStock = await db.products.findMany({
    where: { id: { in: items.map(i => i.productId) }, stock: { lt: 1 } }
  });
  return outOfStock.length ? err('OUT_OF_STOCK') : ok(undefined);
};

const processPayment = async (amount: number, cardId: string): AsyncResult<Payment, 'PAYMENT_FAILED'> => {
  const payment = await stripe.charges.create({ amount, source: cardId });
  return payment.status === 'succeeded'
    ? ok({ id: payment.id, amount })
    : err('PAYMENT_FAILED');
};

// Create workflow
const checkoutWorkflow = createWorkflow({ fetchCart, validateStock, processPayment });

// Server Action
export async function checkout(userId: string, cardId: string) {
  const result = await checkoutWorkflow(async (step) => {
    const cart = await step('fetch-cart', () => fetchCart(userId));
    await step('validate-stock', () => validateStock(cart.items));
    const payment = await step('process-payment', () => processPayment(cart.total, cardId));
    return { orderId: payment.id, total: cart.total };
  });

  // Map to response
  if (result.ok) {
    return { success: true, orderId: result.value.orderId };
  }

  switch (result.error) {
    case 'CART_NOT_FOUND':
      return { success: false, error: 'Your cart is empty' };
    case 'OUT_OF_STOCK':
      return { success: false, error: 'Some items are out of stock' };
    case 'PAYMENT_FAILED':
      return { success: false, error: 'Payment was declined' };
    default:
      return { success: false, error: 'Something went wrong' };
  }
}
```

### Client component

```tsx
// app/checkout/page.tsx
'use client';

import { checkout } from '../actions/checkout';
import { useState } from 'react';

export default function CheckoutPage() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setStatus('loading');
    const result = await checkout('user-123', 'card-456');

    if (result.success) {
      setStatus('success');
    } else {
      setStatus('error');
      setError(result.error);
    }
  }

  return (
    <div>
      <h1>Checkout</h1>
      {status === 'error' && <p className="error">{error}</p>}
      {status === 'success' && <p>Order placed successfully!</p>}
      <button onClick={handleCheckout} disabled={status === 'loading'}>
        {status === 'loading' ? 'Processing...' : 'Place Order'}
      </button>
    </div>
  );
}
```

### API Route with user signup

```typescript
// app/api/signup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

const validateEmail = async (email: string): AsyncResult<string, 'INVALID_EMAIL'> => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) ? ok(email) : err('INVALID_EMAIL');
};

const checkDuplicate = async (email: string): AsyncResult<void, 'EMAIL_EXISTS'> => {
  const existing = await db.users.findUnique({ where: { email } });
  return existing ? err('EMAIL_EXISTS') : ok(undefined);
};

const createUser = async (email: string, password: string): AsyncResult<User, 'DB_ERROR'> => {
  try {
    const user = await db.users.create({
      data: { email, password: await hash(password) }
    });
    return ok(user);
  } catch {
    return err('DB_ERROR');
  }
};

const sendWelcome = async (email: string): AsyncResult<void, 'EMAIL_FAILED'> => {
  try {
    await resend.emails.send({
      to: email,
      subject: 'Welcome!',
      html: '<p>Thanks for signing up!</p>'
    });
    return ok(undefined);
  } catch {
    return err('EMAIL_FAILED');
  }
};

const signupWorkflow = createWorkflow({ validateEmail, checkDuplicate, createUser, sendWelcome });

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  const result = await signupWorkflow(async (step) => {
    const validEmail = await step('validateEmail', () => validateEmail(email));
    await step('checkDuplicate', () => checkDuplicate(validEmail));
    const user = await step('createUser', () => createUser(validEmail, password));
    await step('sendWelcome', () => sendWelcome(user.email));
    return { userId: user.id };
  });

  if (result.ok) {
    return NextResponse.json({ userId: result.value.userId }, { status: 201 });
  }

  // Map errors to HTTP responses
  const errorMap: Record<string, { status: number; message: string }> = {
    INVALID_EMAIL: { status: 400, message: 'Invalid email address' },
    EMAIL_EXISTS: { status: 409, message: 'Email already registered' },
    DB_ERROR: { status: 500, message: 'Failed to create account' },
    EMAIL_FAILED: { status: 500, message: 'Account created but welcome email failed' },
  };

  const errorInfo = errorMap[result.error as string] ?? { status: 500, message: 'Unknown error' };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}
```

## Next.js (Pages Router)

### API handler pattern

```typescript
// pages/api/orders/[id].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

const fetchOrder = async (id: string): AsyncResult<Order, 'NOT_FOUND'> => {
  const order = await db.orders.findUnique({ where: { id } });
  return order ? ok(order) : err('NOT_FOUND');
};

const checkOwnership = async (order: Order, userId: string): AsyncResult<void, 'FORBIDDEN'> => {
  return order.userId === userId ? ok(undefined) : err('FORBIDDEN');
};

const orderWorkflow = createWorkflow({ fetchOrder, checkOwnership });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const userId = req.headers['x-user-id'] as string;

  const result = await orderWorkflow(async (step) => {
    const order = await step('fetchOrder', () => fetchOrder(id as string));
    await step('checkOwnership', () => checkOwnership(order, userId));
    return order;
  });

  if (result.ok) {
    return res.status(200).json(result.value);
  }

  switch (result.error) {
    case 'NOT_FOUND':
      return res.status(404).json({ error: 'Order not found' });
    case 'FORBIDDEN':
      return res.status(403).json({ error: 'Access denied' });
    default:
      return res.status(500).json({ error: 'Internal error' });
  }
}
```

## Express

### Middleware pattern

```typescript
// middleware/workflow.ts
import { Request, Response, NextFunction } from 'express';
import { Result } from 'awaitly';

type ErrorMapping = Record<string, { status: number; message: string }>;

export function withWorkflow<T>(
  handler: (req: Request) => Promise<Result<T, unknown>>,
  errorMap: ErrorMapping = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await handler(req);

      if (result.ok) {
        return res.json(result.value);
      }

      const errorKey = typeof result.error === 'string'
        ? result.error
        : (result.error as { type?: string })?.type ?? 'UNKNOWN';

      const errorInfo = errorMap[errorKey] ?? { status: 500, message: 'Internal error' };
      return res.status(errorInfo.status).json({ error: errorInfo.message });
    } catch (error) {
      next(error);
    }
  };
}
```

### Route with checkout

```typescript
// routes/checkout.ts
import express from 'express';
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';
import { withWorkflow } from '../middleware/workflow';

const router = express.Router();

// Define operations
const fetchCart = async (userId: string): AsyncResult<Cart, 'CART_EMPTY'> => {
  const cart = await db.carts.findUnique({ where: { userId } });
  return cart?.items.length ? ok(cart) : err('CART_EMPTY');
};

const reserveInventory = async (items: CartItem[]): AsyncResult<Reservation, 'INVENTORY_UNAVAILABLE'> => {
  // Reserve inventory for 15 minutes
  const reservation = await inventoryService.reserve(items, { ttlMinutes: 15 });
  return reservation ? ok(reservation) : err('INVENTORY_UNAVAILABLE');
};

const processPayment = async (amount: number, token: string): AsyncResult<Payment, 'PAYMENT_DECLINED'> => {
  const payment = await stripeService.charge(amount, token);
  return payment.succeeded ? ok(payment) : err('PAYMENT_DECLINED');
};

const createOrder = async (cart: Cart, payment: Payment): AsyncResult<Order, 'ORDER_FAILED'> => {
  try {
    const order = await db.orders.create({
      data: { items: cart.items, paymentId: payment.id, total: cart.total }
    });
    return ok(order);
  } catch {
    return err('ORDER_FAILED');
  }
};

const checkoutWorkflow = createWorkflow({
  fetchCart, reserveInventory, processPayment, createOrder
});

// Route handler
router.post('/checkout', withWorkflow(
  async (req) => {
    const { userId } = req.body;
    const paymentToken = req.body.paymentToken;

    return checkoutWorkflow(async (step) => {
      const cart = await step('fetch-cart', () => fetchCart(userId));
      const reservation = await step('reserve', () => reserveInventory(cart.items));
      const payment = await step('pay', () => processPayment(cart.total, paymentToken));
      const order = await step('create-order', () => createOrder(cart, payment));
      return { orderId: order.id, total: order.total };
    });
  },
  {
    CART_EMPTY: { status: 400, message: 'Your cart is empty' },
    INVENTORY_UNAVAILABLE: { status: 409, message: 'Some items are no longer available' },
    PAYMENT_DECLINED: { status: 402, message: 'Payment was declined' },
    ORDER_FAILED: { status: 500, message: 'Failed to create order' },
  }
));

export default router;
```

### Express with saga (compensation)

```typescript
// routes/transfer.ts
import { createSagaWorkflow } from 'awaitly/saga';

const transferWorkflow = createSagaWorkflow({
  debitAccount: async (accountId: string, amount: number) => {
    return await accountService.debit(accountId, amount);
  },
  creditAccount: async (accountId: string, amount: number) => {
    return await accountService.credit(accountId, amount);
  },
});

router.post('/transfer', async (req, res) => {
  const { fromAccount, toAccount, amount } = req.body;

  const result = await transferWorkflow(async (saga) => {
    // Debit source account - compensate by crediting back
    await saga.step(
      'debit',
      () => debitAccount(fromAccount, amount),
      { compensate: () => creditAccount(fromAccount, amount) } // Undo on failure
    );

    // Credit destination - no compensation needed (it's the last step)
    await saga.step('credit', () => creditAccount(toAccount, amount));

    return { success: true };
  });

  if (result.ok) {
    return res.json({ message: 'Transfer completed' });
  }

  // If credit failed, debit was automatically reversed
  return res.status(500).json({ error: 'Transfer failed, funds returned' });
});
```

## Fastify

### Plugin pattern

```typescript
// plugins/workflow.ts
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

// Declare types
declare module 'fastify' {
  interface FastifyInstance {
    workflows: {
      checkout: ReturnType<typeof createWorkflow>;
      signup: ReturnType<typeof createWorkflow>;
    };
  }
}

const workflowPlugin: FastifyPluginAsync = async (fastify) => {
  // Define operations using fastify's db instance
  const fetchUser = async (id: string): AsyncResult<User, 'USER_NOT_FOUND'> => {
    const user = await fastify.db.users.findUnique({ where: { id } });
    return user ? ok(user) : err('USER_NOT_FOUND');
  };

  const fetchCart = async (userId: string): AsyncResult<Cart, 'CART_EMPTY'> => {
    const cart = await fastify.db.carts.findUnique({ where: { userId } });
    return cart?.items.length ? ok(cart) : err('CART_EMPTY');
  };

  const processPayment = async (amount: number): AsyncResult<Payment, 'PAYMENT_FAILED'> => {
    // ... payment logic
    return ok({ id: 'pay_123', amount });
  };

  // Register workflows
  fastify.decorate('workflows', {
    checkout: createWorkflow({ fetchUser, fetchCart, processPayment }),
    signup: createWorkflow({ /* ... */ }),
  });
};

export default fp(workflowPlugin);
```

### Route handler

```typescript
// routes/checkout.ts
import { FastifyPluginAsync } from 'fastify';

const checkoutRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/checkout', async (request, reply) => {
    const { userId } = request.body as { userId: string };

    const result = await fastify.workflows.checkout(async (step) => {
      const user = await step('fetchUser', () => fetchUser(userId));
      const cart = await step('fetchCart', () => fetchCart(userId));
      const payment = await step('processPayment', () => processPayment(cart.total));
      return { orderId: payment.id };
    });

    if (result.ok) {
      return { success: true, orderId: result.value.orderId };
    }

    const errorResponses: Record<string, { statusCode: number; message: string }> = {
      USER_NOT_FOUND: { statusCode: 404, message: 'User not found' },
      CART_EMPTY: { statusCode: 400, message: 'Cart is empty' },
      PAYMENT_FAILED: { statusCode: 402, message: 'Payment failed' },
    };

    const error = errorResponses[result.error as string] ?? { statusCode: 500, message: 'Error' };
    return reply.status(error.statusCode).send({ error: error.message });
  });
};

export default checkoutRoutes;
```

## tRPC

### Router with workflows

```typescript
// server/routers/order.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

// Operations
const fetchOrder = async (id: string, userId: string): AsyncResult<Order, 'NOT_FOUND' | 'FORBIDDEN'> => {
  const order = await db.orders.findUnique({ where: { id } });
  if (!order) return err('NOT_FOUND');
  if (order.userId !== userId) return err('FORBIDDEN');
  return ok(order);
};

const cancelOrder = async (order: Order): AsyncResult<Order, 'CANNOT_CANCEL'> => {
  if (order.status !== 'pending') return err('CANNOT_CANCEL');
  const updated = await db.orders.update({
    where: { id: order.id },
    data: { status: 'cancelled' }
  });
  return ok(updated);
};

const refundPayment = async (paymentId: string): AsyncResult<void, 'REFUND_FAILED'> => {
  const refund = await stripe.refunds.create({ payment_intent: paymentId });
  return refund.status === 'succeeded' ? ok(undefined) : err('REFUND_FAILED');
};

const orderWorkflow = createWorkflow({ fetchOrder, cancelOrder, refundPayment });

// Helper to convert Result errors to TRPCError
function toTRPCError(error: string | { type: string }): TRPCError {
  const code = typeof error === 'string' ? error : error.type;

  const mapping: Record<string, { code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR'; message: string }> = {
    NOT_FOUND: { code: 'NOT_FOUND', message: 'Order not found' },
    FORBIDDEN: { code: 'FORBIDDEN', message: 'Access denied' },
    CANNOT_CANCEL: { code: 'BAD_REQUEST', message: 'Order cannot be cancelled' },
    REFUND_FAILED: { code: 'INTERNAL_SERVER_ERROR', message: 'Refund failed' },
  };

  const info = mapping[code] ?? { code: 'INTERNAL_SERVER_ERROR', message: 'Unknown error' };
  return new TRPCError(info);
}

export const orderRouter = router({
  cancel: protectedProcedure
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await orderWorkflow(async (step) => {
        const order = await step('fetchOrder', () => fetchOrder(input.orderId, ctx.user.id));
        const cancelled = await step('cancelOrder', () => cancelOrder(order));
        await step('refundPayment', () => refundPayment(order.paymentId));
        return cancelled;
      });

      if (result.ok) {
        return { success: true, order: result.value };
      }

      throw toTRPCError(result.error);
    }),

  get: protectedProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ input, ctx }) => {
      const result = await fetchOrder(input.orderId, ctx.user.id);

      if (result.ok) {
        return result.value;
      }

      throw toTRPCError(result.error);
    }),
});
```

### Client usage

```tsx
// components/OrderActions.tsx
import { trpc } from '../utils/trpc';

export function OrderActions({ orderId }: { orderId: string }) {
  const utils = trpc.useUtils();
  const cancelMutation = trpc.order.cancel.useMutation({
    onSuccess: () => {
      utils.order.get.invalidate({ orderId });
    },
  });

  return (
    <button
      onClick={() => cancelMutation.mutate({ orderId })}
      disabled={cancelMutation.isPending}
    >
      {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Order'}
    </button>
  );
}
```

## Hono

### Middleware pattern

```typescript
// src/middleware/workflow.ts
import { Context, Next } from 'hono';
import { Result } from 'awaitly';

type ErrorMapping = Record<string, { status: number; message: string }>;

export function handleWorkflowResult<T>(
  result: Result<T, unknown>,
  c: Context,
  errorMap: ErrorMapping = {}
) {
  if (result.ok) {
    return c.json(result.value);
  }

  const errorKey = typeof result.error === 'string'
    ? result.error
    : (result.error as { type?: string })?.type ?? 'UNKNOWN';

  const errorInfo = errorMap[errorKey] ?? { status: 500, message: 'Internal error' };
  return c.json({ error: errorInfo.message }, errorInfo.status);
}
```

### Route handler

```typescript
// src/routes/users.ts
import { Hono } from 'hono';
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';
import { handleWorkflowResult } from '../middleware/workflow';

const app = new Hono();

const validateEmail = async (email: string): AsyncResult<string, 'INVALID_EMAIL'> => {
  return email.includes('@') ? ok(email) : err('INVALID_EMAIL');
};

const createUser = async (email: string): AsyncResult<User, 'USER_EXISTS'> => {
  const existing = await db.users.findUnique({ where: { email } });
  if (existing) return err('USER_EXISTS');
  const user = await db.users.create({ data: { email } });
  return ok(user);
};

const signupWorkflow = createWorkflow({ validateEmail, createUser });

app.post('/signup', async (c) => {
  const { email } = await c.req.json();

  const result = await signupWorkflow(async (step) => {
    const validEmail = await step('validateEmail', () => validateEmail(email));
    const user = await step('createUser', () => createUser(validEmail));
    return { userId: user.id };
  });

  return handleWorkflowResult(result, c, {
    INVALID_EMAIL: { status: 400, message: 'Invalid email' },
    USER_EXISTS: { status: 409, message: 'Email already registered' },
  });
});

export default app;
```

## Best Practices

### Keep workflows in separate files

```
src/
  workflows/
    checkout.ts      # Workflow definition and operations
    signup.ts
    order.ts
  routes/
    checkout.ts      # HTTP handlers that use workflows
    users.ts
```

### Reuse operations across workflows

```typescript
// workflows/shared.ts
export const fetchUser = async (id: string): AsyncResult<User, 'USER_NOT_FOUND'> => {
  const user = await db.users.findUnique({ where: { id } });
  return user ? ok(user) : err('USER_NOT_FOUND');
};

// workflows/checkout.ts
import { fetchUser } from './shared';

const checkoutWorkflow = createWorkflow({
  fetchUser,
  fetchCart,
  processPayment,
});

// workflows/profile.ts
import { fetchUser } from './shared';

const profileWorkflow = createWorkflow({
  fetchUser,
  updateProfile,
});
```

### Type-safe error mapping

```typescript
// utils/errors.ts
type WorkflowError =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'PAYMENT_FAILED';

const HTTP_ERROR_MAP: Record<WorkflowError, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  FORBIDDEN: { status: 403, message: 'Access denied' },
  INVALID_INPUT: { status: 400, message: 'Invalid input' },
  PAYMENT_FAILED: { status: 402, message: 'Payment failed' },
};

export function mapError(error: WorkflowError) {
  return HTTP_ERROR_MAP[error] ?? { status: 500, message: 'Internal error' };
}
```

## Next

[Learn about Production Deployment →](/advanced/production-deployment/)
