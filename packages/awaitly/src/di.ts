import type { UnexpectedError } from "./core";
import type { RunConfig, Workflow } from "./workflow/types";

/**
 * Pre-bind dependency overrides on a workflow.
 *
 * Returns another `Workflow` with the same shape — chain `.withDeps()`,
 * call `.run()` / `.runWithState()` exactly as before.
 *
 * Precedence (lowest → highest):
 *   createWorkflow deps  <  withDeps deps  <  run config deps
 */
export function withDeps<E, U = UnexpectedError, Deps = unknown, C = void>(
  workflow: Workflow<E, U, Deps, C>,
  overrides: Partial<Deps>
): Workflow<E, U, Deps, C> {
  const forward = <Method extends "run" | "runWithState">(method: Method) =>
    ((...args: unknown[]) => {
      const last = args.at(-1);
      const hasConfig =
        args.length > 0 &&
        typeof last === "object" &&
        last !== null &&
        !Array.isArray(last) &&
        typeof last !== "function";

      const config = hasConfig ? (last as RunConfig<E, U, C, Deps>) : undefined;
      const head = hasConfig ? args.slice(0, -1) : args;

      const mergedDeps = { ...overrides, ...(config?.deps ?? {}) } as Partial<Deps>;
      const mergedConfig: RunConfig<E, U, C, Deps> = config
        ? { ...config, deps: mergedDeps }
        : ({ deps: mergedDeps } as RunConfig<E, U, C, Deps>);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (workflow[method] as any)(...head, mergedConfig);
    }) as Workflow<E, U, Deps, C>[Method];

  return {
    run: forward("run"),
    runWithState: forward("runWithState"),
    withDeps(nextOverrides: Partial<Deps>) {
      return withDeps(workflow, { ...overrides, ...nextOverrides });
    },
  };
}
