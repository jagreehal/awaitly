import { createWorkflow } from "awaitly/workflow";

const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1" }),
  fetchPosts: async () => [],
});

async function run() {
  return await workflow.run(async (step, deps) => {
    /** JSDoc for first step. */
    const user = await step(() => deps.fetchUser());
    const posts = await step(() => deps.fetchPosts());
    /** JSDoc for third step. */
    const extra = await step(() => Promise.resolve("extra"));
    return { user, posts, extra };
  });
}
