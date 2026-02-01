import { createWorkflow } from "awaitly/workflow";

const workflow = createWorkflow({
  fetchUser: async () => ({ id: "1", name: "Alice" }),
});

async function run() {
  return await workflow(async (step, deps) => {
    /**
     * Load user by ID from the API.
     */
    const user = await step(() => deps.fetchUser());
    return user;
  });
}
