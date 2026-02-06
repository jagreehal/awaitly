/**
 * Test fixture: Data flow tracking with out and ctx.ref()
 *
 * Tests analyzer extraction of:
 * - out keys for writes
 * - ctx.ref() for reads
 * - Data dependency graph between steps
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const fetchUser = async (id: string): AsyncResult<{ id: string; name: string; email: string }, "USER_NOT_FOUND"> => {
  return ok({ id, name: "Alice", email: "alice@example.com" });
};

const fetchPreferences = async (userId: string): AsyncResult<{ theme: string; notifications: boolean }, "PREFS_NOT_FOUND"> => {
  return ok({ theme: "dark", notifications: true });
};

const fetchOrders = async (userId: string): AsyncResult<Array<{ id: string; total: number }>, "ORDERS_FETCH_FAILED"> => {
  return ok([{ id: "order1", total: 50 }]);
};

const generateReport = async (
  userName: string,
  orderCount: number,
  theme: string
): AsyncResult<{ reportId: string; content: string }, "REPORT_FAILED"> => {
  return ok({ reportId: "report1", content: `Report for ${userName}` });
};

export const userReportWorkflow = createWorkflow("userReportWorkflow", {
  fetchUser,
  fetchPreferences,
  fetchOrders,
  generateReport,
});

export async function generateUserReport(userId: string) {
  return await userReportWorkflow(async (step, deps) => {
    // Step writes to 'user' key
    const user = await step('fetchUser', () => deps.fetchUser(userId), {
      errors: ['USER_NOT_FOUND'],
      out: 'user',
    });

    // Step writes to 'prefs' key, reads 'user'
    const prefs = await step('fetchPreferences', () => deps.fetchPreferences(user.id), {
      errors: ['PREFS_NOT_FOUND'],
      out: 'prefs',
    });

    // Step writes to 'orders' key, reads 'user'
    const orders = await step('fetchOrders', () => deps.fetchOrders(user.id), {
      errors: ['ORDERS_FETCH_FAILED'],
      out: 'orders',
    });

    // Step reads 'user', 'orders', and 'prefs'
    const report = await step('generateReport', () => deps.generateReport(
      user.name,
      orders.length,
      prefs.theme
    ), {
      errors: ['REPORT_FAILED'],
      out: 'report',
    });

    return report;
  });
}
