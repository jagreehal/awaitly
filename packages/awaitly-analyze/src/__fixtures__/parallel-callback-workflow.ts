/**
 * Parallel workflow using step.parallel with direct dependency calls
 */
import { createWorkflow } from "../../workflow";
import { ok, type AsyncResult } from "../../core";

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

export const parallelCallbackWorkflow = createWorkflow({
  fetchUser,
  fetchPosts,
  fetchFriends,
});

export async function runParallelCallbackWorkflow(userId: string) {
  return await parallelCallbackWorkflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser(userId), {
      key: "user",
      name: "Fetch User",
    });

    const results = await step.parallel("Fetch posts and friends", {
      posts: () => deps.fetchPosts(user.id),
      friends: () => deps.fetchFriends(user.id),
    });

    return { user, results };
  });
}
