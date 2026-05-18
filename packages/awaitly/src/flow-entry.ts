/**
 * awaitly/flow
 *
 * Auto-stepifying workflow entry. Each dep call becomes a step whose ID is
 * the deps-object key — so the body reads like plain `async/await` with no
 * `step('id', () => ...)` wrappers.
 */
export { flow, type Flowed, type FlowOptions } from "./flow";
