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

export const userDashboardWorkflow = createWorkflow("userDashboardWorkflow", {
  fetchProfile,
  fetchActivity,
  fetchNotifications,
});

export async function loadUserDashboard(userId: string) {
  return await userDashboardWorkflow(async ({ step, deps }) => {
    const { profile, activity } = await step.parallel('Fetch profile and activity', {
      profile: () => deps.fetchProfile(userId),
      activity: () => deps.fetchActivity(userId),
    });

    const { notifications } = await step.parallel('Fetch notifications', {
      notifications: {
        fn: () => deps.fetchNotifications(userId),
        errors: ['NOTIFICATIONS_FETCH_FAILED'],
      },
    });

    return { profile, activity, notifications };
  });
}
