import { describe, it, expect } from "vitest";
import { Awaitly, type AsyncResult } from "../index";
import { run } from "../run-entry";
import { tryAsyncBoundary } from "../result/retry";
import { createWorkflow } from "../workflow-entry";
import { createSagaWorkflow } from "../saga-entry";

const { ok, err, TaggedError } = Awaitly;

type BookingRequest = {
  hotelId: string;
  roomCode: string;
  total: number;
  cardToken: string;
  attemptId: string;
};

type ValidatedBooking = BookingRequest;

type LockedRoom = {
  hotelId: string;
  roomCode: string;
  lockedRate: number;
};

type PaymentTxn = {
  id: string;
};

type SubmittedReservation = {
  reservationId: string;
};

type Booking = {
  confirmationCode: string;
};

class RoomUnavailable extends TaggedError("RoomUnavailable")<{
  message: string;
  hotelId: string;
  roomCode: string;
}> {}

class RateChanged extends TaggedError("RateChanged")<{
  message: string;
  hotelId: string;
  oldRate: number;
  newRate: number;
}> {}

class PaymentLimbo extends TaggedError("PaymentLimbo")<{
  message: string;
  reservationAttemptId: string;
  cause: unknown;
}> {}

class TransientVendorError extends TaggedError("TransientVendorError")<{
  message: string;
  vendor: string;
  cause: unknown;
}> {}

class InvalidBookingInput extends TaggedError("InvalidBookingInput")<{
  message: string;
  field: string;
}> {}

type BookingError =
  | RoomUnavailable
  | RateChanged
  | PaymentLimbo
  | TransientVendorError
  | InvalidBookingInput;

const isTimeout = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "kind" in cause &&
  (cause as { kind: string }).kind === "TIMEOUT_AFTER_CAPTURE";

const toUxResponse = (error: BookingError) =>
  TaggedError.match(error, {
    RoomUnavailable: (e) => ({
      kind: "show-alternates" as const,
      hotelId: e.hotelId,
    }),
    RateChanged: (e) => ({
      kind: "reconfirm-price" as const,
      oldRate: e.oldRate,
      newRate: e.newRate,
    }),
    PaymentLimbo: (e) => ({
      kind: "escalate" as const,
      attemptId: e.reservationAttemptId,
      doNotRetry: true,
    }),
    TransientVendorError: () => ({
      kind: "silent-retry" as const,
    }),
    InvalidBookingInput: (e) => ({
      kind: "form-error" as const,
      field: e.field,
    }),
  });

const validateBookingRequest = (
  req: BookingRequest
): AsyncResult<ValidatedBooking, InvalidBookingInput> => {
  if (!req.cardToken) {
    return Promise.resolve(
      err(
        new InvalidBookingInput({
          message: "Card token required",
          field: "cardToken",
        })
      )
    );
  }
  return Promise.resolve(ok(req));
};

const confirmAvailability = (
  req: ValidatedBooking,
  roomState: { soldOut: boolean }
): AsyncResult<LockedRoom, RoomUnavailable | RateChanged> => {
  if (roomState.soldOut) {
    return Promise.resolve(
      err(
        new RoomUnavailable({
          message: "Room sold out",
          hotelId: req.hotelId,
          roomCode: req.roomCode,
        })
      )
    );
  }

  if (req.total > 400) {
    return Promise.resolve(
      err(
        new RateChanged({
          message: "Rate changed",
          hotelId: req.hotelId,
          oldRate: req.total,
          newRate: 399,
        })
      )
    );
  }

  return Promise.resolve(
    ok({ hotelId: req.hotelId, roomCode: req.roomCode, lockedRate: req.total })
  );
};

const submitReservation = (
  _locked: LockedRoom,
  _txn: PaymentTxn
): AsyncResult<SubmittedReservation, TransientVendorError> =>
  Promise.resolve(ok({ reservationId: "res-1" }));

const persistConfirmation = (
  _submitted: SubmittedReservation
): AsyncResult<Booking, never> => Promise.resolve(ok({ confirmationCode: "ABC123" }));

async function reserveRoomTyped(
  req: BookingRequest,
  deps: {
    roomState: { soldOut: boolean };
    authorizePayment: (req: ValidatedBooking) => AsyncResult<PaymentTxn, PaymentLimbo | TransientVendorError>;
    calls: { authorizePayment: number };
  }
): AsyncResult<Booking, BookingError> {
  return run<Booking, BookingError>(
    async ({ step }) => {
      const validated = await step("validateBooking", () => validateBookingRequest(req));
      const locked = await step("confirmAvailability", () =>
        confirmAvailability(validated, deps.roomState)
      );
      const payment = await step("authorizePayment", async () => {
        deps.calls.authorizePayment += 1;
        return deps.authorizePayment(validated);
      });
      const submitted = await step("submitReservation", () =>
        submitReservation(locked, payment)
      );
      return step("persistConfirmation", () => persistConfirmation(submitted));
    },
    {
      catchUnexpected: (cause): BookingError => {
        throw cause;
      },
    }
  );
}

describe("Errors Deserve Better benchmark", () => {
  it("beats naive retry in OTA-299-like timeout-after-capture scenario", async () => {
    const ledger = { charges: 0 };

    const naiveGateway = {
      calls: 0,
      async authorize() {
        this.calls += 1;
        ledger.charges += 1;
        if (this.calls === 1) {
          throw { kind: "TIMEOUT_AFTER_CAPTURE" };
        }
        return { id: `txn-${this.calls}` } as PaymentTxn;
      },
    };

    // Naive flow retries generic timeout and captures twice.
    await naiveGateway.authorize().catch(async () => naiveGateway.authorize());
    expect(ledger.charges).toBe(2);

    const typedGateway = {
      calls: 0,
      async authorize() {
        this.calls += 1;
        ledger.charges += 1;
        throw { kind: "TIMEOUT_AFTER_CAPTURE" };
      },
    };

    const calls = { authorizePayment: 0 };
    const result = await reserveRoomTyped(
      {
        hotelId: "h1",
        roomCode: "KING",
        total: 250,
        cardToken: "tok_abc",
        attemptId: "attempt-42",
      },
      {
        roomState: { soldOut: false },
        calls,
        authorizePayment: (validated) =>
          tryAsyncBoundary({
            try: () => typedGateway.authorize(),
            catch: (cause) => {
              if (isTimeout(cause)) {
                return new PaymentLimbo({
                  message: "Payment authorization timed out",
                  reservationAttemptId: validated.attemptId,
                  cause,
                });
              }
              return new TransientVendorError({
                message: "Payment vendor failed",
                vendor: "stripe",
                cause,
              });
            },
            retry: {
              attempts: 4,
              initialDelay: 1,
              shouldRetry: (e) => e instanceof TransientVendorError,
            }
          }),
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const ux = toUxResponse(result.error);
    expect(ux).toEqual({
      kind: "escalate",
      attemptId: "attempt-42",
      doNotRetry: true,
    });

    // One authorization attempt inside typed flow (no retry for PaymentLimbo).
    expect(calls.authorizePayment).toBe(1);
    expect(typedGateway.calls).toBe(1);

    // Total ledger charges include 2 from naive + 1 from typed (no duplicate from retry).
    expect(ledger.charges).toBe(3);
  });

  it("short-circuits before payment when room is unavailable", async () => {
    const calls = { authorizePayment: 0 };

    const result = await reserveRoomTyped(
      {
        hotelId: "h2",
        roomCode: "QUEEN",
        total: 180,
        cardToken: "tok_abc",
        attemptId: "attempt-99",
      },
      {
        roomState: { soldOut: true },
        calls,
        authorizePayment: async () =>
          ok({
            id: "txn-never",
          }),
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBeInstanceOf(RoomUnavailable);
    expect(calls.authorizePayment).toBe(0);

    const ux = toUxResponse(result.error);
    expect(ux.kind).toBe("show-alternates");
  });

  it("maps each known error variant to a distinct UX path", () => {
    const paths = [
      toUxResponse(
        new RoomUnavailable({
          message: "sold out",
          hotelId: "h1",
          roomCode: "K",
        })
      ).kind,
      toUxResponse(
        new RateChanged({
          message: "changed",
          hotelId: "h1",
          oldRate: 200,
          newRate: 250,
        })
      ).kind,
      toUxResponse(
        new PaymentLimbo({
          message: "timeout",
          reservationAttemptId: "a1",
          cause: new Error("timeout"),
        })
      ).kind,
      toUxResponse(
        new TransientVendorError({
          message: "vendor down",
          vendor: "stripe",
          cause: new Error("503"),
        })
      ).kind,
      toUxResponse(
        new InvalidBookingInput({
          message: "bad card",
          field: "cardToken",
        })
      ).kind,
    ];

    expect(paths).toEqual([
      "show-alternates",
      "reconfirm-price",
      "escalate",
      "silent-retry",
      "form-error",
    ]);
  });
});

describe("Errors Deserve Better with awaitly/workflow", () => {
  it("uses createWorkflow with the same typed error semantics", async () => {
    const typedGateway = {
      calls: 0,
      async authorize() {
        this.calls += 1;
        throw { kind: "TIMEOUT_AFTER_CAPTURE" };
      },
    };

    const deps = {
      validateBookingRequest,
      confirmAvailability: (req: ValidatedBooking) =>
        confirmAvailability(req, { soldOut: false }),
      authorizePayment: (req: ValidatedBooking) =>
        tryAsyncBoundary({
          try: () => typedGateway.authorize(),
          catch: (cause) => {
            if (isTimeout(cause)) {
              return new PaymentLimbo({
                message: "Payment authorization timed out",
                reservationAttemptId: req.attemptId,
                cause,
              });
            }
            return new TransientVendorError({
              message: "Payment vendor failed",
              vendor: "stripe",
              cause,
            });
          },
          retry: {
            attempts: 4,
            initialDelay: 1,
            shouldRetry: (e) => e instanceof TransientVendorError,
          }
        }),
      submitReservation,
      persistConfirmation,
    };

    const workflow = createWorkflow("reserve-room", deps);

    const result = await workflow.run(async ({ step, deps }) => {
      const req: BookingRequest = {
        hotelId: "h3",
        roomCode: "KING",
        total: 200,
        cardToken: "tok_abc",
        attemptId: "attempt-workflow",
      };
      const validated = await step("validateBooking", () =>
        deps.validateBookingRequest(req)
      );
      const locked = await step("confirmAvailability", () =>
        deps.confirmAvailability(validated)
      );
      const payment = await step("authorizePayment", () =>
        deps.authorizePayment(validated)
      );
      const submitted = await step("submitReservation", () =>
        deps.submitReservation(locked, payment)
      );
      return step("persistConfirmation", () => deps.persistConfirmation(submitted));
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PaymentLimbo);
    expect(typedGateway.calls).toBe(1);
  });
});

describe("Errors Deserve Better with awaitly/saga", () => {
  it("adds compensation when post-payment reservation fails", async () => {
    const refunded: string[] = [];
    const refundPayment = (txnId: string) => {
      refunded.push(txnId);
    };

    const deps = {
      validateBookingRequest,
      confirmAvailability: (req: ValidatedBooking) =>
        confirmAvailability(req, { soldOut: false }),
      authorizePayment: (_req: ValidatedBooking): AsyncResult<PaymentTxn, never> =>
        Promise.resolve(ok({ id: "txn-777" })),
      submitReservation: (
        _locked: LockedRoom,
        _txn: PaymentTxn
      ): AsyncResult<SubmittedReservation, TransientVendorError> =>
        Promise.resolve(
          err(
            new TransientVendorError({
              message: "GDS submit failed",
              vendor: "gds",
              cause: new Error("503"),
            })
          )
        ),
      persistConfirmation,
    };

    const saga = createSagaWorkflow("reserve-room-saga", deps);
    const result = await saga.run(async ({ step, deps }) => {
      const req: BookingRequest = {
        hotelId: "h4",
        roomCode: "SUITE",
        total: 300,
        cardToken: "tok_abc",
        attemptId: "attempt-saga",
      };

      const validated = await step("validateBooking", () =>
        deps.validateBookingRequest(req)
      );
      const locked = await step("confirmAvailability", () =>
        deps.confirmAvailability(validated)
      );
      const payment = await step(
        "authorizePayment",
        () => deps.authorizePayment(validated),
        {
          compensate: (txn) => refundPayment(txn.id),
        }
      );

      const submitted = await step("submitReservation", () =>
        deps.submitReservation(locked, payment)
      );
      return step("persistConfirmation", () => deps.persistConfirmation(submitted));
    });

    expect(result.ok).toBe(false);
    expect(refunded).toEqual(["txn-777"]);
  });
});
