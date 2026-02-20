import { createWorkflow } from "awaitly/workflow";

const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1", name: "Alice" }),
});

async function run() {
  return await workflow.run(async (step, deps) => {
    const user = await step(() => deps.fetchUser());
    return user;
  });
}
