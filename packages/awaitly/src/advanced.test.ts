/**
 * Test file to verify all code examples in docs/advanced.md work as documented.
 * Run with: pnpm vitest run src/advanced.test.ts
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, vi } from 'vitest';
import { Awaitly, type AsyncResult, type Result } from "./index";
const {
  all,
  allSettled,
  any,
  partition,
  allAsync,
  allSettledAsync,
  anyAsync,
  from,
  fromPromise,
  tryAsync,
  fromNullable,
  map,
  mapError,
  match,
  andThen,
  tap,
  ok,
  err,
} = Awaitly;
import {
  run,
  createWorkflow,
  isStepComplete,
} from '../src/workflow-entry';
import {
  createApprovalStep,
  createApprovalStateCollector,
  isPendingApproval,
  injectApproval,
  hasPendingApproval,
  getPendingApprovals,
  clearStep,
} from '../src/hitl-entry';

// Types for examples
type User = { id: string; name: string };
type Post = { id: number; title: string };

describe('Advanced Examples', () => {
  describe('Batch operations', () => {
    it('should work with all() - all must succeed', () => {
      const combined = all([ok(1), ok(2), ok(3)]);
      expect(combined.ok).toBe(true);
      if (combined.ok) {
        expect(combined.value).toEqual([1, 2, 3]);
      }
    });

    it('should work with all() - short-circuits on first error', () => {
      const combined = all([ok(1), err('ERROR'), ok(3)]);
      expect(combined.ok).toBe(false);
      if (!combined.ok) {
        expect(combined.error).toBe('ERROR');
      }
    });

    it('should work with allSettled() - collects all errors', async () => {
      const validateEmail = (email: string): Result<string, 'INVALID_EMAIL'> =>
        email.includes('@') ? ok(email) : err('INVALID_EMAIL');

      const validatePassword = (password: string): Result<string, 'WEAK_PASSWORD'> =>
        password.length >= 8 ? ok(password) : err('WEAK_PASSWORD');

      const email = 'test@example.com';
      const password = 'short';
      const validated = allSettled([validateEmail(email), validatePassword(password)]);

      expect(validated.ok).toBe(false);
      if (!validated.ok) {
        expect(validated.error).toHaveLength(1);
        expect(validated.error[0].error).toBe('WEAK_PASSWORD');
      }
    });

    it('should work with any() - first success wins', () => {
      const first = any([err('A'), ok('success'), err('B')]);
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.value).toBe('success');
      }
    });

    it('should work with any() - all errors returns first error', () => {
      const first = any([err('A'), err('B'), err('C')]);
      expect(first.ok).toBe(false);
      if (!first.ok) {
        expect(first.error).toBe('A');
      }
    });

    it('should work with partition() - split successes and failures', () => {
      const results: Result<number, string>[] = [
        ok(1),
        err('ERROR_1'),
        ok(3),
        err('ERROR_2'),
      ];
      const { values, errors } = partition(results);

      expect(values).toEqual([1, 3]);
      expect(errors).toEqual(['ERROR_1', 'ERROR_2']);
    });

    it('should work with allAsync()', async () => {
      const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
        id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');

      const fetchPosts = async (_userId: string): AsyncResult<Post[], 'FETCH_ERROR'> =>
        ok([{ id: 1, title: 'Hello' }]);

      const result = await allAsync([fetchUser('1'), fetchPosts('1')]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].name).toBe('Alice');
        expect(result.value[1]).toHaveLength(1);
      }
    });

    it('should work with allSettledAsync()', async () => {
      const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
        id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');

      const fetchPosts = async (_userId: string): AsyncResult<Post[], 'FETCH_ERROR'> =>
        ok([{ id: 1, title: 'Hello' }]);

      const result = await allSettledAsync([fetchUser('2'), fetchPosts('1')]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveLength(1);
        expect(result.error[0].error).toBe('NOT_FOUND');
      }
    });

    it('should work with anyAsync()', async () => {
      const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
        id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');

      const fetchPosts = async (_userId: string): AsyncResult<Post[], 'FETCH_ERROR'> =>
        ok([{ id: 1, title: 'Hello' }]);

      const result = await anyAsync([fetchUser('2'), fetchPosts('1')]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
      }
    });
  });

  describe('Dynamic error mapping', () => {
    it('should work with onError option in step.try', async () => {
      const workflow = createWorkflow("workflow", {});

      // Mock fetch
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await workflow(async ({ step: _step }) => {
        const step = _step as unknown as { try: <T, Err>(id: string, op: () => Promise<T>, opts: { onError: (e: unknown) => Err }) => Promise<T> };
        const data = await step.try(
          "fetch-api",
          () => fetch('/api/data'),
          { onError: (e: unknown) => ({ type: 'API_ERROR' as const, message: String(e) }) }
        );

        return data;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty('type', 'API_ERROR');
        expect(result.error).toHaveProperty('message');
      }
    });

    it('should work with onError for validation errors', async () => {
      // Simulate a schema validation library
      const schema = {
        parse: (data: unknown) => {
          if (typeof data !== 'object' || data === null) {
            throw { issues: ['Invalid data'] };
          }
          return data;
        },
      };

      const workflow = createWorkflow("workflow", {});

      const result = await workflow(async ({ step: _step }) => {
        const step = _step as unknown as { try: <T, Err>(id: string, op: () => T, opts: { onError: (e: unknown) => Err }) => Promise<T> };
        const parsed = await step.try(
          "validate-schema",
          () => schema.parse(null),
          { onError: (e: unknown) => ({ type: 'VALIDATION_ERROR' as const, issues: (e as { issues: string[] }).issues }) }
        );

        return parsed;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty('type', 'VALIDATION_ERROR');
        expect(result.error).toHaveProperty('issues');
      }
    });
  });

  describe('Wrapping existing code', () => {
    it('should work with from() for sync throwing functions', () => {
      const parsed = from(
        () => JSON.parse('{"key": "value"}'),
        (cause) => ({ type: 'PARSE_ERROR' as const, cause })
      );

      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value).toEqual({ key: 'value' });
      }
    });

    it('should work with from() - handles parse errors', () => {
      const parsed = from(
        () => JSON.parse('invalid json'),
        (cause) => ({ type: 'PARSE_ERROR' as const, cause })
      );

      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.type).toBe('PARSE_ERROR');
      }
    });

    it('should work with fromPromise()', async () => {
      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'test' }),
      });

      const result = await fromPromise(
        fetch('/api').then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        () => 'FETCH_FAILED' as const
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ data: 'test' });
      }
    });

    it('should work with fromPromise() - handles fetch errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await fromPromise(
        fetch('/api').then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        () => 'FETCH_FAILED' as const
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('FETCH_FAILED');
      }
    });

    it('should work with tryAsync()', async () => {
      const result = await tryAsync(
        async () => {
          return { data: 'test' };
        },
        () => 'ASYNC_ERROR' as const
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ data: 'test' });
      }
    });

    it('should work with tryAsync() - handles async errors', async () => {
      const result = await tryAsync(
        async () => {
          throw new Error('Async error');
        },
        () => 'ASYNC_ERROR' as const
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('ASYNC_ERROR');
      }
    });

    it('should work with fromNullable()', () => {
      // Simulate a DOM element (in real usage, this would be document.getElementById('app'))
      const element = fromNullable(
        { id: 'app', tagName: 'DIV' } as unknown as HTMLElement,
        () => 'NOT_FOUND' as const
      );

      expect(element.ok).toBe(true);
    });

    it('should work with fromNullable() - handles null', () => {
      const element = fromNullable(
        null,
        () => 'NOT_FOUND' as const
      );

      expect(element.ok).toBe(false);
      if (!element.ok) {
        expect(element.error).toBe('NOT_FOUND');
      }
    });
  });

  describe('Transformers', () => {
    it('should work with map()', () => {
      const doubled = map(ok(21), (n) => n * 2);
      expect(doubled.ok).toBe(true);
      if (doubled.ok) {
        expect(doubled.value).toBe(42);
      }
    });

    it('should work with mapError()', () => {
      const mapped = mapError(err('not_found'), (e) => e.toUpperCase());
      expect(mapped.ok).toBe(false);
      if (!mapped.ok) {
        expect(mapped.error).toBe('NOT_FOUND');
      }
    });

    it('should work with match()', () => {
      const result = ok({ name: 'Alice' });
      const message = match(result, {
        ok: (user) => `Hello ${user.name}`,
        err: (error) => `Error: ${error}`,
      });

      expect(message).toBe('Hello Alice');
    });

    it('should work with match() - error case', () => {
      const result = err('NOT_FOUND') as Result<{ name: string }, string>;
      const message = match(result, {
        ok: (user: { name: string }) => `Hello ${user.name}`,
        err: (error) => `Error: ${error}`,
      });

      expect(message).toBe('Error: NOT_FOUND');
    });

    it('should work with andThen()', async () => {
      const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
        id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');

      const fetchPosts = async (userId: string): AsyncResult<Post[], 'FETCH_ERROR'> =>
        ok([{ id: 1, title: 'Hello' }]);

      const userResult = await fetchUser('1');
      const userPosts = await (andThen as <T, U, E, F, C1, C2>(r: Result<T, E, C1>, fn: (value: T) => Result<U, F, C2> | AsyncResult<U, F, C2>) => Result<U, E | F, C1 | C2> | AsyncResult<U, E | F, C1 | C2>)(userResult, (user) => fetchPosts(user.id));

      expect(userPosts.ok).toBe(true);
      if (userPosts.ok) {
        expect(userPosts.value).toHaveLength(1);
      }
    });

    it('should work with tap()', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = ok({ name: 'Alice' });
      const logged = tap(result, (user) => console.log('Got user:', user.name));

      expect(logged.ok).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Got user:', 'Alice');
      consoleSpy.mockRestore();
    });
  });

  describe('Human-in-the-loop (HITL)', () => {
    it('should work with createApprovalStep and createApprovalStateCollector', async () => {
      const fetchData = async (id: string): AsyncResult<{ data: string }, 'NOT_FOUND'> =>
        ok({ data: 'test data' });

      const requireManagerApproval = createApprovalStep<{ approvedBy: string }>({
        key: 'manager-approval',
        checkApproval: async () => {
          // Simulate pending approval
          return { status: 'pending' as const };
        },
        pendingReason: 'Waiting for manager approval',
      });

      const collector = createApprovalStateCollector();
      const workflow = createWorkflow(
        "workflow",
        { fetchData, requireManagerApproval },
        { onEvent: collector.handleEvent }
      );

      const result = await workflow(async ({ step }) => {
        const data = await step('fetchData', () => fetchData('123'), { key: 'data' });
        const approval = await step('requireManagerApproval', () => requireManagerApproval(), { key: 'manager-approval' });
        return { data, approvedBy: approval.approvedBy };
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isPendingApproval(result.error)).toBe(true);
      }

      if (!result.ok && isPendingApproval(result.error)) {
        expect(result.error.reason).toBe('Waiting for manager approval');
        expect(collector.hasPendingApprovals()).toBe(true);
        const pending = collector.getPendingApprovals();
        expect(pending).toHaveLength(1);
        expect(pending[0].stepKey).toBe('manager-approval');
      }
    });

    it('should work with injectApproval for resuming', async () => {
      const fetchData = async (id: string): AsyncResult<{ data: string }, 'NOT_FOUND'> =>
        ok({ data: 'test data' });

      const requireManagerApproval = createApprovalStep<{ approvedBy: string }>({
        key: 'manager-approval',
        checkApproval: async () => {
          return { status: 'pending' as const };
        },
      });

      const collector = createApprovalStateCollector();
      const workflow1 = createWorkflow(
        "workflow",
        { fetchData, requireManagerApproval },
        { onEvent: collector.handleEvent }
      );

      const result1 = await workflow1(async ({ step }) => {
        const data = await step('fetchData', () => fetchData('123'), { key: 'data' });
        const approval = await step('requireManagerApproval', () => requireManagerApproval(), { key: 'manager-approval' });
        return { data, approvedBy: approval.approvedBy };
      });

      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        expect(isPendingApproval(result1.error)).toBe(true);
      }

      // Save state
      const savedState = collector.getResumeState();

      // Inject approval
      const resumeState = injectApproval(savedState, {
        stepKey: 'manager-approval',
        value: { approvedBy: 'alice@example.com' },
      });

      const workflow2 = createWorkflow(
        "workflow",
        { fetchData, requireManagerApproval },
        { resumeState }
      );

      const result2 = await workflow2(async ({ step }) => {
        const data = await step('fetchData', () => fetchData('123'), { key: 'data' });
        const approval = await step('requireManagerApproval', () => requireManagerApproval(), { key: 'manager-approval' });
        return { data, approvedBy: approval.approvedBy };
      });

      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.approvedBy).toBe('alice@example.com');
      }
    });

    it('should work with HITL utilities', () => {
      const state = {
        steps: new Map([
          ['step1', { result: ok('value1') }],
          ['approval:deploy', { result: err({ type: 'PENDING_APPROVAL' as const, stepKey: 'approval:deploy' }) }],
          ['approval:staging', { result: err({ type: 'PENDING_APPROVAL' as const, stepKey: 'approval:staging' }) }],
        ]),
      };

      expect(hasPendingApproval(state, 'approval:deploy')).toBe(true);
      expect(hasPendingApproval(state, 'step1')).toBe(false);

      const pending = getPendingApprovals(state);
      expect(pending).toHaveLength(2);
      expect(pending).toContain('approval:deploy');
      expect(pending).toContain('approval:staging');

      const cleared = clearStep(state, 'approval:deploy');
      expect(cleared.steps.has('approval:deploy')).toBe(false);
      expect(cleared.steps.has('approval:staging')).toBe(true);
    });
  });

  describe('Interop with neverthrow', () => {
    it('should work with neverthrow Result conversion', async () => {
      // Simulate neverthrow Result
      type NTResult<T, E> = { isOk: () => boolean; value?: T; error?: E };
      const ntResult: NTResult<User, 'NOT_FOUND'> = {
        isOk: () => true,
        value: { id: '1', name: 'Alice' },
      };

      function fromNeverthrow<T, E>(ntResult: NTResult<T, E>): Result<T, E> {
        return ntResult.isOk() ? ok(ntResult.value!) : err(ntResult.error!);
      }

      const workflow = createWorkflow("workflow", {});

      const result = await workflow(async ({ step }) => {
        const validated = await step('fromNeverthrow', () => fromNeverthrow(ntResult) as Result<User, never>);
        return validated;
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('Alice');
      }
    });
  });

  describe('Low-level: run()', () => {
    it('should work with run()', async () => {
      const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
        id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');

      const result = await run(async ({ step }) => {
        const user = await step('fetchUser', () => fetchUser('1'));
        return user;
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('Alice');
      }
    });

    it('should work with run.strict()', async () => {
      const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
        id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');

      type AppError = 'NOT_FOUND' | 'UNAUTHORIZED' | 'UNEXPECTED';

      const result = await run.strict<User, AppError>(
        async ({ step }) => {
          return await step('fetchUser', () => fetchUser('1'));
        },
        { catchUnexpected: () => 'UNEXPECTED' as const }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        const error: AppError = result.error;
        expect(['NOT_FOUND', 'UNAUTHORIZED', 'UNEXPECTED']).toContain(error);
      }
    });
  });
});
