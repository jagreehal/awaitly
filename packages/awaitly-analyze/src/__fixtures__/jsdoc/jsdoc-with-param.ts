import { createWorkflow } from "awaitly/workflow";

const workflow = createWorkflow("workflow", {
  fetchUser: async (id: string) => ({ id, name: "Alice" }),
});

async function run(id: string) {
  return await workflow(async (step, deps) => {
    /**
     * Loads the user by ID.
     * @param id - The user ID to fetch
     * @returns The user object
     */
    const user = await step(() => deps.fetchUser(id));
    return user;
  });
}
