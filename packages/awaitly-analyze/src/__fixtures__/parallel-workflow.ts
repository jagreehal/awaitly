/**
 * Parallel workflow for testing static analysis
 * Note: This file is only used for AST parsing, not execution
 */
import { createWorkflow } from "../../workflow";
import { ok, allAsync, type AsyncResult } from "../../core";

const fetchUser = async (
  id: string
): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
  return ok({ id, name: "Alice" });
};

const fetchPosts = async (
  _userId: string
): AsyncResult<Array<{ id: string }>, "FETCH_ERROR"> => {
  return ok([{ id: "1" }]);
};

const fetchFriends = async (
  _userId: string
): AsyncResult<Array<{ id: string }>, "FETCH_ERROR"> => {
  return ok([{ id: "2" }]);
};

const fetchSettings = async (
  _userId: string
): AsyncResult<{ theme: string }, "FETCH_ERROR"> => {
  return ok({ theme: "dark" });
};

export const parallelWorkflow = createWorkflow("parallelWorkflow", {
  fetchUser,
  fetchPosts,
  fetchFriends,
  fetchSettings,
});

// Example invocation - simplified for static analysis
// The static analyzer extracts the allAsync call pattern
export async function runParallelWorkflow(userId: string) {
  return await parallelWorkflow(async (step, deps) => {
    // Step 1: Fetch user first
    const user = await step(() => deps.fetchUser(userId), {
      key: "user",
      name: "Fetch User",
    });

    // Step 2: Parallel fetch using allAsync directly (outside step for simpler types)
    // The static analyzer will detect the allAsync call pattern
    const parallelResults = await allAsync([
      deps.fetchPosts(user.id),
      deps.fetchFriends(user.id),
      deps.fetchSettings(user.id),
    ]);

    if (!parallelResults.ok) {
      return parallelResults;
    }

    const [posts, friends, settings] = parallelResults.value;

    return { user, posts, friends, settings };
  });
}
