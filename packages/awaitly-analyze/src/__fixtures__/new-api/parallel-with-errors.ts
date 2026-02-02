/**
 * Test fixture: step.parallel() with errors
 *
 * Tests analyzer extraction of:
 * - Parallel branches with error declarations
 * - Both shorthand and strict forms
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const fetchProfile = async (userId: string): AsyncResult<{ name: string; avatar: string }, "PROFILE_NOT_FOUND"> => {
  return ok({ name: "Alice", avatar: "avatar.png" });
};

const fetchActivity = async (userId: string): AsyncResult<Array<{ action: string }>, "ACTIVITY_FETCH_FAILED"> => {
  return ok([{ action: "login" }]);
};

const fetchNotifications = async (userId: string): AsyncResult<Array<{ message: string }>, "NOTIFICATIONS_FETCH_FAILED"> => {
  return ok([{ message: "Welcome!" }]);
};

export const userDashboardWorkflow = createWorkflow({
  id: 'userDashboard',
  deps: { fetchProfile, fetchActivity, fetchNotifications },
});

export async function loadUserDashboard(userId: string) {
  return await userDashboardWorkflow(async (step, ctx) => {
    // Parallel with shorthand (default mode)
    const { profile, activity } = await step.parallel({
      profile: () => ctx.deps.fetchProfile(userId),
      activity: () => ctx.deps.fetchActivity(userId),
    });

    // Parallel with explicit errors (strict mode)
    const { notifications } = await step.parallel({
      notifications: {
        fn: () => ctx.deps.fetchNotifications(userId),
        errors: ['NOTIFICATIONS_FETCH_FAILED'],
      },
    }, { name: 'Fetch notifications' });

    return { profile, activity, notifications };
  });
}
