// Source for checkout-after.json, the homepage review chart. Regenerate with:
//   npx awaitly-analyze checkout-after.ts --format=xstate --no-output-adjacent > checkout-after.json
// then delete meta.location from each state (it holds this machine's absolute path).
import { createWorkflow, ok, err, type AsyncResult } from 'awaitly';

type Hold = { id: string };
type Payment = { id: string };
type Shipment = { id: string };

const reserve = async (cart: string[]): AsyncResult<Hold, { type: 'OUT_OF_STOCK' }> =>
  cart.length ? ok({ id: 'h1' }) : err({ type: 'OUT_OF_STOCK' });
const charge = async (hold: Hold): AsyncResult<Payment, { type: 'CARD_DECLINED' }> =>
  ok({ id: 'p1' });
const ship = async (payment: Payment): AsyncResult<Shipment, { type: 'SHIP_FAILED' }> =>
  ok({ id: 's1' });

const screen = async (hold: Hold): AsyncResult<Hold, { type: 'FRAUD_FLAGGED' }> => ok(hold);

const checkout = createWorkflow('checkout', { reserve, screen, charge, ship });

export async function runCheckout(cart: string[]) {
  return checkout.run(async ({ step, deps }) => {
    const hold = await step('reserve', () => deps.reserve(cart));
    await step('screen', () => deps.screen(hold));
    const payment = await step.retry('charge', () => deps.charge(hold), {
      attempts: 3,
      backoff: 'exponential',
    });
    return step('ship', () => deps.ship(payment), { key: payment.id });
  });
}
