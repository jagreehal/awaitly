/**
 * Error class to wrap Result errors for use with React Query.
 * When queryFn receives !result.ok, throw new ResultError(result.error)
 * so useQuery treats it as an error; component can check error instanceof ResultError
 * and handle error.error with typed switch.
 */
export class ResultError<E = unknown> extends Error {
  constructor(public readonly error: E) {
    super(JSON.stringify(error));
    this.name = "ResultError";
  }
}
