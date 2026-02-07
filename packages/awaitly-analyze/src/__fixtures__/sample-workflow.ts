/**
 * Sample workflow for testing static analysis
 */
import { createWorkflow } from "../../workflow";
import { ok, type AsyncResult } from "../../core";

// Dependencies
const fetchUser = async (
  id: string
): AsyncResult<{ id: string; name: string; isPremium: boolean }, "NOT_FOUND"> => {
  return ok({ id, name: "Alice", isPremium: true });
};

const fetchPosts = async (
  _userId: string
): AsyncResult<Array<{ id: string; title: string }>, "FETCH_ERROR"> => {
  return ok([{ id: "1", title: "Hello World" }]);
};

const applyDiscount = async (
  _userId: string
): AsyncResult<{ discount: number }, "DISCOUNT_ERROR"> => {
  return ok({ discount: 10 });
};

// Create the workflow
export const sampleWorkflow = createWorkflow("sampleWorkflow", {
  fetchUser,
  fetchPosts,
  applyDiscount,
});

// Example invocation (for analysis purposes)
export async function runSampleWorkflow(userId: string) {
  return await sampleWorkflow(async (step, deps) => {
    // Step 1: Fetch user (explicit ID as first param)
    const user = await step("Fetch User", () => deps.fetchUser(userId), {
      key: "user",
    });

    // Step 2: Conditional - apply discount if premium
    if (user.isPremium) {
      await step("Apply Discount", () => deps.applyDiscount(user.id), {
        key: "discount",
      });
    }

    // Step 3: Fetch posts
    const posts = await step("Fetch Posts", () => deps.fetchPosts(user.id), {
      key: "posts",
    });

    return { user, posts };
  });
}
