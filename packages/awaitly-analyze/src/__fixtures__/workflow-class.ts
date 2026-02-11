/**
 * Fixture: class-based Workflow for static analyzer tests.
 * Use assumeImported: true when analyzing this source.
 */
import { Workflow, type WorkflowRunEvent } from "awaitly/workflow";

const fetchUser = async (_id: string) => ({ id: "1", name: "Alice" });
const fetchPosts = async (_userId: string) => [{ title: "Hello" }];
const deps = { fetchUser, fetchPosts };

export class GetUserWorkflow extends Workflow<typeof deps> {
  constructor() {
    super("getUser", deps);
  }

  async run(event: WorkflowRunEvent<{ userId: string }>, step: any) {
    const user = await step("fetchUser", () => this.deps.fetchUser(event.payload.userId));
    const posts = await step("fetchPosts", () => this.deps.fetchPosts(user.id));
    return { user, posts };
  }
}

export class NamedWorkflow extends Workflow<typeof deps> {
  constructor() {
    super("image-processing", deps);
  }

  async run(event: WorkflowRunEvent<{ imageKey: string }>, step: any) {
    await step("fetch", () => this.deps.fetchUser(event.payload.imageKey));
  }
}
