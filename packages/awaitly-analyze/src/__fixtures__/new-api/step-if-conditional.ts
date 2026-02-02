/**
 * Test fixture: step.if() for labelled conditionals
 *
 * Tests analyzer extraction of:
 * - step.if() calls with id and conditionLabel
 * - Conditional branches containing steps
 * - Decision nodes in workflow graph
 */
import { createWorkflow, ok, err, type AsyncResult } from "awaitly";

const fetchUser = async (
  id: string
): AsyncResult<{ id: string; isPremium: boolean }, "NOT_FOUND"> => {
  return ok({ id, isPremium: true });
};

const loadPremiumDashboard = async (
  userId: string
): AsyncResult<{ type: "premium"; features: string[] }, "DASHBOARD_ERROR"> => {
  return ok({ type: "premium", features: ["analytics", "exports"] });
};

const loadFreeDashboard = async (
  userId: string
): AsyncResult<{ type: "free"; features: string[] }, "DASHBOARD_ERROR"> => {
  return ok({ type: "free", features: ["basic"] });
};

export const dashboardWorkflow = createWorkflow({
  id: 'dashboard',
  deps: { fetchUser, loadPremiumDashboard, loadFreeDashboard },
});

export async function loadDashboard(userId: string) {
  return await dashboardWorkflow(async (step, ctx) => {
    const user = await step('getUser', () => ctx.deps.fetchUser(userId), {
      errors: ['NOT_FOUND'],
      out: 'user',
    });

    // Labelled conditional using step.if()
    if (step.if('user-type', 'user.isPremium', () => user.isPremium)) {
      const dashboard = await step('loadPremium', () => ctx.deps.loadPremiumDashboard(user.id), {
        errors: ['DASHBOARD_ERROR'],
      });
      return { user, dashboard };
    } else {
      const dashboard = await step('loadFree', () => ctx.deps.loadFreeDashboard(user.id), {
        errors: ['DASHBOARD_ERROR'],
      });
      return { user, dashboard };
    }
  });
}
