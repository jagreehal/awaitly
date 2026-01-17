/**
 * awaitly/saga
 *
 * Saga pattern: distributed transactions with automatic compensation.
 *
 * @example
 * ```typescript
 * import { createSagaWorkflow, runSaga } from 'awaitly/saga';
 *
 * const bookingWorkflow = createSagaWorkflow({
 *   reserveFlight: { execute: reserveFlight, compensate: cancelFlight },
 *   reserveHotel: { execute: reserveHotel, compensate: cancelHotel },
 *   chargeCard: { execute: chargeCard, compensate: refundCard },
 * });
 *
 * const result = await runSaga(bookingWorkflow, async (step) => {
 *   const flight = await step('reserveFlight', flightDetails);
 *   const hotel = await step('reserveHotel', hotelDetails);
 *   const payment = await step('chargeCard', paymentDetails);
 *   return { flight, hotel, payment };
 * });
 * // If chargeCard fails, reserveHotel and reserveFlight are automatically compensated
 * ```
 */

export {
  type CompensationAction,
  type SagaStepOptions,
  type SagaCompensationError,
  type SagaContext,
  type SagaEvent,
  type SagaWorkflowOptions,
  type SagaResult,
  isSagaCompensationError,
  createSagaWorkflow,
  runSaga,
} from "./saga";
