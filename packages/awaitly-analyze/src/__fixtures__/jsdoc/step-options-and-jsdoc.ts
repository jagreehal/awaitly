import { createWorkflow } from "awaitly/workflow";

const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1", name: "Alice" }),
});

async function run() {
  return await workflow(async (step, deps) => {
    /**
     * JSDoc above this step.
     */
    const user = await step(() => deps.fetchUser(), {
      key: "user",
      description: "Options description",
    });
    return user;
  });
}
