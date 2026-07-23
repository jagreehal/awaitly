/**
 * awaitly/saga
 *
 * Saga pattern: distributed transactions with automatic compensation.
 *
 * @example
 * ```typescript
 * import { createSagaWorkflow } from 'awaitly/saga';
 *
 * const booking = createSagaWorkflow('booking', {
 *   reserveFlight, cancelFlight,
 *   reserveHotel, cancelHotel,
 *   chargeCard, refundCard,
 * });
 *
 * const result = await booking.run(async ({ step, deps }) => {
 *   const flight = await step('reserveFlight', () => deps.reserveFlight(details), {
 *     compensate: (f) => deps.cancelFlight(f.id),
 *   });
 *   const hotel = await step('reserveHotel', () => deps.reserveHotel(details), {
 *     compensate: (h) => deps.cancelHotel(h.id),
 *   });
 *   const payment = await step('chargeCard', () => deps.chargeCard(details), {
 *     compensate: (p) => deps.refundCard(p.id),
 *   });
 *   return { flight, hotel, payment };
 * });
 * // If chargeCard fails, hotel + flight reservations are compensated automatically.
 * ```
 */

export {
  type CompensationAction,
  type SagaWorkflow,
  type SagaStep,
  type SagaStepOptions,
  type SagaCompensationError,
  type SagaEvent,
  type SagaWorkflowOptions,
  type SagaResult,
  isSagaCompensationError,
  createSagaWorkflow,
  runSaga,
} from "./saga";
