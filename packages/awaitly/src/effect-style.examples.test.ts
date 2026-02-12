/**
 * Effect-Style Ergonomics Examples
 *
 * This file demonstrates the new Effect-inspired APIs added to awaitly
 * for improved developer experience while maintaining async/await.
 */

import { describe, it, expect } from 'vitest';
import { Awaitly } from './index';
import { createWorkflow, run } from './workflow-entry';

const { ok, err } = Awaitly;

describe('Effect-Style Ergonomics Examples', () => {
  // ==========================================================================
  // Example Domain: User Management System
  // ==========================================================================

  type User = {
    id: string;
    name: string;
    email: string;
    isPremium: boolean;
  };

  type EnrichedUser = User & {
    preferences: Record<string, unknown>;
    tier: 'free' | 'premium' | 'enterprise';
  };

  type Order = {
    id: string;
    userId: string;
    total: number;
    items: string[];
  };

  // Mock dependencies
  const fetchUser = async (id: string) => {
    if (id === 'missing') return err('NOT_FOUND' as const);
    return ok<User>({
      id,
      name: 'Alice',
      email: 'alice@example.com',
      isPremium: true,
    });
  };

  const enrichUserProfile = async (user: User) => {
    return ok<EnrichedUser>({
      ...user,
      preferences: { theme: 'dark', language: 'en' },
      tier: user.isPremium ? 'premium' : 'free',
    });
  };

  const fetchOrders = async (userId: string) => {
    return ok<Order[]>([
      { id: '1', userId, total: 100, items: ['item1', 'item2'] },
      { id: '2', userId, total: 200, items: ['item3'] },
    ]);
  };

  const sendNotification = async (email: string, message: string) => {
    if (email.includes('fail')) return err('EMAIL_FAILED' as const);
    return ok({ sent: true, to: email, message });
  };

  // ==========================================================================
  // 1. step.run() - Unwrap AsyncResults Directly
  // ==========================================================================

  describe('step.run() - Direct unwrapping', () => {
    it('eliminates wrapper function boilerplate', async () => {
      const result = await run(async (step) => {
        // BEFORE: const user = await step('fetchUser', () => fetchUser('123'));
        // AFTER:  const user = await step.run('fetchUser', fetchUser('123'));

        const user = await step.run('fetchUser', fetchUser('123'));
        return user.name;
      });

      expect(result).toEqual({ ok: true, value: 'Alice' });
    });

    it('works seamlessly with createWorkflow', async () => {
      const workflow = createWorkflow('getUserProfile', { fetchUser });

      const result = await workflow(async (step, { fetchUser }) => {
        const user = await step.run('fetchUser', fetchUser('123'));
        return { id: user.id, email: user.email };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({ id: '123', email: 'alice@example.com' });
      }
    });
  });

  // ==========================================================================
  // 2. step.andThen() - Chain Operations
  // ==========================================================================

  describe('step.andThen() - Chainable operations', () => {
    it('chains dependent operations elegantly', async () => {
      const result = await run(async (step) => {
        // Fetch user
        const user = await step.run('fetchUser', fetchUser('123'));

        // Chain enrichment operation
        const enriched = await step.andThen('enrichProfile', user, enrichUserProfile);

        return enriched.tier;
      });

      expect(result).toEqual({ ok: true, value: 'premium' });
    });

    it('demonstrates natural error propagation', async () => {
      const result = await run(async (step) => {
        const user = await step.run('fetchUser', fetchUser('missing'));
        const enriched = await step.andThen('enrichProfile', user, enrichUserProfile);
        return enriched.tier;
      }, { onError: () => {} });

      expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
    });
  });

  // ==========================================================================
  // 3. step.match() - Pattern Matching with Step Tracking
  // ==========================================================================

  describe('step.match() - Pattern matching', () => {
    it('handles success and error paths explicitly', async () => {
      const result = await run(async (step) => {
        const userResult = await fetchUser('123');

        return await step.match('handleUser', userResult, {
          ok: async (user) => {
            // Success path - can execute additional steps
            await step.run('sendWelcome', sendNotification(user.email, 'Welcome!'));
            return `Onboarded ${user.name}`;
          },
          err: async (error) => {
            // Error path - handle gracefully
            return `Failed to onboard: ${error}`;
          },
        });
      });

      expect(result).toEqual({ ok: true, value: 'Onboarded Alice' });
    });

    it('allows graceful degradation', async () => {
      const result = await run(async (step) => {
        const notificationResult = await sendNotification('user@fail.com', 'Test');

        const status = await step.match('handleNotification', notificationResult, {
          ok: () => 'sent',
          err: async (error) => {
            // Log error but don't fail the workflow
            await step('logError', () => ok({ error, logged: true }));
            return 'failed-but-logged';
          },
        });

        return status;
      });

      expect(result).toEqual({ ok: true, value: 'failed-but-logged' });
    });
  });

  // ==========================================================================
  // 4. step.all() - Effect.all-style Parallel Execution
  // ==========================================================================

  describe('step.all() - Parallel operations', () => {
    it('executes operations in parallel with named results', async () => {
      const result = await run(async (step) => {
        // BEFORE:
        // const { user, orders } = await step('fetchAll', () =>
        //   Awaitly.allAsync({ user: fetchUser('123'), orders: fetchOrders('123') })
        // );

        // AFTER - cleaner!
        const { user, orders } = await step.all('fetchAll', {
          user: () => fetchUser('123'),
          orders: () => fetchOrders('123'),
        });

        return {
          userName: user.name,
          orderCount: orders.length,
        };
      });

      expect(result).toEqual({
        ok: true,
        value: { userName: 'Alice', orderCount: 2 },
      });
    });
  });

  // ==========================================================================
  // 5. step.map() - Parallel Batch Processing
  // ==========================================================================

  describe('step.map() - Parallel mapping', () => {
    it('maps over arrays with parallel execution', async () => {
      const userIds = ['1', '2', '3'];

      const result = await run(async (step) => {
        // BEFORE:
        // const users = await step('fetchUsers', () =>
        //   Awaitly.allAsync(userIds.map(id => fetchUser(id)))
        // );

        // AFTER - more intuitive!
        const users = await step.map('fetchUsers', userIds, (id) => fetchUser(id));

        return users.map(u => u.name);
      });

      expect(result).toEqual({
        ok: true,
        value: ['Alice', 'Alice', 'Alice'],
      });
    });

    it('supports concurrency limiting for rate-limited APIs', async () => {
      const userIds = ['1', '2', '3', '4', '5', '6', '7', '8'];

      const result = await run(async (step) => {
        // Process in batches of 3 to respect API rate limits
        const users = await step.map(
          'fetchUsers',
          userIds,
          (id) => fetchUser(id),
          { concurrency: 3 }
        );

        return users.length;
      });

      expect(result).toEqual({ ok: true, value: 8 });
    });
  });

  // ==========================================================================
  // 6. Complete Example - Checkout Workflow
  // ==========================================================================

  describe('Complete checkout workflow example', () => {
    it('demonstrates all new APIs together', async () => {
      const validateOrder = async (data: { userId: string; items: string[] }) => {
        return ok<Order>({
          id: 'order-123',
          userId: data.userId,
          total: data.items.length * 50,
          items: data.items,
        });
      };

      const chargeCard = async (total: number) => {
        return ok({ charged: true, amount: total, receiptId: 'rcpt-456' });
      };

      const workflow = createWorkflow('checkout', {
        fetchUser,
        enrichUserProfile,
        validateOrder,
        chargeCard,
        sendNotification,
      });

      const result = await workflow(async (step, deps) => {
        // 1. Fetch and enrich user in parallel (if possible)
        const user = await step.run('fetchUser', deps.fetchUser('123'));
        const enriched = await step.andThen('enrichUser', user, deps.enrichUserProfile);

        // 2. Validate order
        const order = await step.run(
          'validateOrder',
          deps.validateOrder({ userId: user.id, items: ['item1', 'item2'] })
        );

        // 3. Charge card
        const receipt = await step.run('chargeCard', deps.chargeCard(order.total));

        // 4. Send confirmation with graceful degradation
        const emailResult = await deps.sendNotification(
          enriched.email,
          `Order ${order.id} confirmed!`
        );

        const emailSent = await step.match('handleEmail', emailResult, {
          ok: () => true,
          err: async (error) => {
            // Log but don't fail the workflow
            await step('logEmailFailure', () => ok({ error, orderId: order.id }));
            return false;
          },
        });

        return {
          orderId: order.id,
          userTier: enriched.tier,
          total: receipt.amount,
          receiptId: receipt.receiptId,
          emailSent,
        };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({
          orderId: 'order-123',
          userTier: 'premium',
          total: 100,
          emailSent: true,
        });
      }
    });
  });

  // ==========================================================================
  // 7. Comparison: Before vs After
  // ==========================================================================

  describe('Before vs After comparison', () => {
    it('shows the ergonomic improvements', async () => {
      // ========================================
      // BEFORE: Verbose, lots of wrappers
      // ========================================
      const resultBefore = await run(async (step) => {
        const user = await step('fetchUser', () => fetchUser('123'));
        const enriched = await step('enrich', () => enrichUserProfile(user));

        const orders = await step('fetchOrders', () => fetchOrders(user.id));

        return {
          userName: enriched.name,
          orderCount: orders.length,
        };
      });

      // ========================================
      // AFTER: Clean, Effect-style
      // ========================================
      const resultAfter = await run(async (step) => {
        const user = await step.run('fetchUser', fetchUser('123'));
        const enriched = await step.andThen('enrich', user, enrichUserProfile);

        const { orders } = await step.all('fetchData', {
          orders: () => fetchOrders(user.id),
        });

        return {
          userName: enriched.name,
          orderCount: orders.length,
        };
      });

      // Both produce the same result
      expect(resultBefore).toEqual(resultAfter);
      expect(resultAfter).toEqual({
        ok: true,
        value: { userName: 'Alice', orderCount: 2 },
      });
    });
  });
});
