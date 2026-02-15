import type { AsyncResult, Result } from "./core";
import type { RetryOptions } from "./core";
import { ok, err, retryAsync } from "./core";

// =============================================================================
// Error Types
// =============================================================================

export type FetchNetworkError = {
  readonly _tag: "FetchNetworkError";
  readonly cause: unknown;
};

export type FetchHttpError<B = unknown> = {
  readonly _tag: "FetchHttpError";
  readonly status: number;
  readonly statusText: string;
  readonly body?: B;
};

export type FetchParseError = {
  readonly _tag: "FetchParseError";
  readonly cause: unknown;
  readonly text: string;
};

export type FetchDecodeError = {
  readonly _tag: "FetchDecodeError";
  readonly issues: unknown;
};

export type FetchAbortError = {
  readonly _tag: "FetchAbortError";
  readonly reason: unknown;
};

export type FetchTimeoutError = {
  readonly _tag: "FetchTimeoutError";
  readonly ms: number;
};

/** Convenience union: all errors except FetchDecodeError */
export type FetchError<B = unknown> =
  | FetchNetworkError
  | FetchHttpError<B>
  | FetchParseError
  | FetchAbortError
  | FetchTimeoutError;

/** Convenience union: all errors including FetchDecodeError */
export type FetchErrorWithDecode<B = unknown> = FetchError<B> | FetchDecodeError;

// =============================================================================
// Options
// =============================================================================

/** Options for fetchText, fetchBlob, fetchArrayBuffer */
export type FetchOptions<
  TBody = unknown,
  EHttp = FetchHttpError<TBody>,
> = RequestInit & {
  /** Timeout in ms — creates internal AbortController, composes with user signal */
  timeoutMs?: number;
  /** Read error response body for context. Default: attempt JSON then text */
  errorBody?: (response: Response) => Promise<TBody>;
  /** Map HTTP errors to custom domain errors. Called after error body is read */
  mapError?: (httpError: FetchHttpError<TBody>) => EHttp;
  /** Retry on failure. Number = attempts only; object = full RetryOptions (same semantics as step.retry) */
  retry?: RetryOptions | number;
};

/** Options for fetchJson (extends FetchOptions with decode + strictContentType) */
export type FetchJsonOptions<
  T = unknown,
  TBody = unknown,
  EHttp = FetchHttpError<TBody>,
> = FetchOptions<TBody, EHttp> & {
  /** Validate/transform parsed data. Return ok(T) or err({ issues }) */
  decode?: (raw: unknown) => Result<T, { issues: unknown }>;
  /** If true, check Content-Type header before parsing (FetchParseError on mismatch) */
  strictContentType?: boolean;
};

// =============================================================================
// Internal Helpers
// =============================================================================

function createComposedSignal(
  timeoutMs?: number,
  userSignal?: AbortSignal | null,
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;
  let onAbort: (() => void) | undefined;

  if (timeoutMs !== undefined) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort({ _tag: "Timeout" as const, ms: timeoutMs });
    }, timeoutMs);
  }

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      onAbort = () => controller.abort(userSignal.reason);
      userSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (onAbort && userSignal) userSignal.removeEventListener("abort", onAbort);
    },
    timedOut: () => didTimeout,
  };
}

async function readErrorBody<TBody>(
  response: Response,
  errorBodyFn?: (response: Response) => Promise<TBody>,
): Promise<unknown> {
  if (errorBodyFn) return errorBodyFn(response);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text || undefined;
  }
}

function isJsonContentType(response: Response): boolean {
  const ct = response.headers.get("content-type");
  return ct !== null && /\bjson\b/i.test(ct);
}

/** Shared fetch + signal composition + network/abort/timeout error handling */
async function executeFetch(
  url: string | URL | Request,
  init: RequestInit,
  timeoutMs?: number,
): Promise<
  Result<Response, FetchNetworkError | FetchAbortError | FetchTimeoutError>
> {
  const requestSignal = url instanceof Request ? url.signal : null;
  const userSignal =
    "signal" in init && init.signal === null ? null : (init.signal ?? requestSignal);
  const { signal, cleanup, timedOut } = createComposedSignal(
    timeoutMs,
    userSignal,
  );

  try {
    const response = await fetch(url, { ...init, signal });
    return ok(response);
  } catch (e) {
    if (timedOut()) {
      return err({ _tag: "FetchTimeoutError" as const, ms: timeoutMs! });
    }
    if (signal.aborted) {
      return err({
        _tag: "FetchAbortError" as const,
        reason: signal.reason ?? userSignal?.reason ?? e,
      });
    }
    return err({ _tag: "FetchNetworkError" as const, cause: e });
  } finally {
    cleanup();
  }
}

/** Build FetchHttpError from a non-ok response */
async function buildHttpError<TBody>(
  response: Response,
  errorBody?: (response: Response) => Promise<TBody>,
): Promise<FetchHttpError<TBody>> {
  let body: unknown;
  try {
    body = await readErrorBody(response, errorBody);
  } catch {
    body = undefined;
  }
  return {
    _tag: "FetchHttpError",
    status: response.status,
    statusText: response.statusText,
    ...(body !== undefined ? { body: body as TBody } : {}),
  };
}

function normalizeRetryOptions(retry: RetryOptions | number): RetryOptions {
  return typeof retry === "number" ? { attempts: retry } : retry;
}

/** Fetch + HTTP error handling, always returns FetchHttpError<TBody> (no EHttp generic, no casts) */
async function fetchCore<T, TBody = unknown>(
  url: string | URL | Request,
  init: RequestInit,
  timeoutMs: number | undefined,
  errorBody: ((response: Response) => Promise<TBody>) | undefined,
  retryOpts: RetryOptions | number | undefined,
  parseOk: (response: Response) => Promise<T>,
): Promise<
  Result<
    T,
    | FetchNetworkError
    | FetchAbortError
    | FetchTimeoutError
    | FetchHttpError<TBody>
  >
> {
  const oneAttempt = async (): Promise<
    Result<
      T,
      | FetchNetworkError
      | FetchAbortError
      | FetchTimeoutError
      | FetchHttpError<TBody>
    >
  > => {
    const fetchResult = await executeFetch(url, init, timeoutMs);
    if (!fetchResult.ok) return fetchResult;

    const response = fetchResult.value;

    if (!response.ok) {
      return err(await buildHttpError(response, errorBody));
    }

    try {
      return ok(await parseOk(response));
    } catch (cause) {
      return err({ _tag: "FetchNetworkError" as const, cause });
    }
  };

  if (retryOpts !== undefined) {
    return retryAsync(oneAttempt, normalizeRetryOptions(retryOpts));
  }
  return oneAttempt();
}

/** Map FetchHttpError → EHttp via discriminant narrowing (zero casts) */
async function applyMapError<T, TBody, EHttp>(
  resultPromise: Promise<
    Result<
      T,
      | FetchNetworkError
      | FetchAbortError
      | FetchTimeoutError
      | FetchHttpError<TBody>
    >
  >,
  mapFn: (httpError: FetchHttpError<TBody>) => EHttp,
): Promise<
  Result<
    T,
    FetchNetworkError | FetchAbortError | FetchTimeoutError | EHttp
  >
> {
  const result = await resultPromise;
  if (result.ok) return result;
  if (result.error._tag === "FetchHttpError") {
    return err(mapFn(result.error));
  }
  return err(result.error);
}

// =============================================================================
// Public API
// =============================================================================

// --- fetchJson ---

export function fetchJson<T = unknown, TBody = unknown>(
  url: string | URL | Request,
  options?: FetchJsonOptions<T, TBody> & { mapError?: undefined },
): AsyncResult<
  T | null,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | FetchHttpError<TBody>
  | FetchParseError
  | FetchDecodeError
>;

export function fetchJson<T, TBody, EHttp>(
  url: string | URL | Request,
  options: FetchJsonOptions<T, TBody, EHttp> & {
    mapError: (httpError: FetchHttpError<TBody>) => EHttp;
  },
): AsyncResult<
  T | null,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | EHttp
  | FetchParseError
  | FetchDecodeError
>;

export function fetchJson<
  T = unknown,
  TBody = unknown,
  EHttp = FetchHttpError<TBody>,
>(
  url: string | URL | Request,
  options?: FetchJsonOptions<T, TBody, EHttp>,
): AsyncResult<
  T | null,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | EHttp
  | FetchHttpError<TBody>
  | FetchParseError
  | FetchDecodeError
> {
  const oneAttempt = async (): Promise<
    Result<
      T | null,
      | FetchNetworkError
      | FetchAbortError
      | FetchTimeoutError
      | FetchHttpError<TBody>
      | FetchParseError
      | FetchDecodeError
    >
  > => {
    const fetchResult = await executeFetch(
      url,
      options ?? {},
      options?.timeoutMs,
    );
    if (!fetchResult.ok) return fetchResult;

    const response = fetchResult.value;

    if (!response.ok) {
      const httpErr = await buildHttpError(response, options?.errorBody);
      return err(httpErr);
    }

    if (response.status === 204) return ok(null);

    try {
      if (options?.strictContentType && !isJsonContentType(response)) {
        const text = await response.text();
        return err({
          _tag: "FetchParseError" as const,
          cause: new Error("Expected JSON Content-Type"),
          text,
        });
      }

      const text = await response.text();

      if (text === "") return ok(null);

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        return err({ _tag: "FetchParseError" as const, cause, text });
      }

      if (options?.decode) {
        const result = options.decode(parsed);
        if (!result.ok) {
          return err({
            _tag: "FetchDecodeError" as const,
            issues: result.error.issues,
          });
        }
        return ok(result.value);
      }

      return ok(parsed as T);
    } catch (cause) {
      return err({
        _tag: "FetchParseError" as const,
        cause,
        text: "",
      });
    }
  };

  return (async () => {
    const raw =
      options?.retry !== undefined
        ? await retryAsync(oneAttempt, normalizeRetryOptions(options.retry))
        : await oneAttempt();
    if (raw.ok) return raw;
    if (raw.error._tag === "FetchHttpError" && options?.mapError) {
      return err(options.mapError(raw.error));
    }
    return raw;
  })();
}

// --- fetchText ---

export function fetchText<TBody = unknown>(
  url: string | URL | Request,
  options?: FetchOptions<TBody> & { mapError?: undefined },
): AsyncResult<
  string,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | FetchHttpError<TBody>
>;

export function fetchText<TBody, EHttp>(
  url: string | URL | Request,
  options: FetchOptions<TBody, EHttp> & {
    mapError: (httpError: FetchHttpError<TBody>) => EHttp;
  },
): AsyncResult<
  string,
  FetchNetworkError | FetchAbortError | FetchTimeoutError | EHttp
>;

export function fetchText<
  TBody = unknown,
  EHttp = FetchHttpError<TBody>,
>(
  url: string | URL | Request,
  options?: FetchOptions<TBody, EHttp>,
): AsyncResult<
  string,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | EHttp
  | FetchHttpError<TBody>
> {
  const core = fetchCore(
    url,
    options ?? {},
    options?.timeoutMs,
    options?.errorBody,
    options?.retry,
    (r) => r.text(),
  );
  return options?.mapError ? applyMapError(core, options.mapError) : core;
}

// --- fetchBlob ---

export function fetchBlob<TBody = unknown>(
  url: string | URL | Request,
  options?: FetchOptions<TBody> & { mapError?: undefined },
): AsyncResult<
  Blob,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | FetchHttpError<TBody>
>;

export function fetchBlob<TBody, EHttp>(
  url: string | URL | Request,
  options: FetchOptions<TBody, EHttp> & {
    mapError: (httpError: FetchHttpError<TBody>) => EHttp;
  },
): AsyncResult<
  Blob,
  FetchNetworkError | FetchAbortError | FetchTimeoutError | EHttp
>;

export function fetchBlob<
  TBody = unknown,
  EHttp = FetchHttpError<TBody>,
>(
  url: string | URL | Request,
  options?: FetchOptions<TBody, EHttp>,
): AsyncResult<
  Blob,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | EHttp
  | FetchHttpError<TBody>
> {
  const core = fetchCore(
    url,
    options ?? {},
    options?.timeoutMs,
    options?.errorBody,
    options?.retry,
    (r) => r.blob(),
  );
  return options?.mapError ? applyMapError(core, options.mapError) : core;
}

// --- fetchArrayBuffer ---

export function fetchArrayBuffer<TBody = unknown>(
  url: string | URL | Request,
  options?: FetchOptions<TBody> & { mapError?: undefined },
): AsyncResult<
  ArrayBuffer,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | FetchHttpError<TBody>
>;

export function fetchArrayBuffer<TBody, EHttp>(
  url: string | URL | Request,
  options: FetchOptions<TBody, EHttp> & {
    mapError: (httpError: FetchHttpError<TBody>) => EHttp;
  },
): AsyncResult<
  ArrayBuffer,
  FetchNetworkError | FetchAbortError | FetchTimeoutError | EHttp
>;

export function fetchArrayBuffer<
  TBody = unknown,
  EHttp = FetchHttpError<TBody>,
>(
  url: string | URL | Request,
  options?: FetchOptions<TBody, EHttp>,
): AsyncResult<
  ArrayBuffer,
  | FetchNetworkError
  | FetchAbortError
  | FetchTimeoutError
  | EHttp
  | FetchHttpError<TBody>
> {
  const core = fetchCore(
    url,
    options ?? {},
    options?.timeoutMs,
    options?.errorBody,
    options?.retry,
    (r) => r.arrayBuffer(),
  );
  return options?.mapError ? applyMapError(core, options.mapError) : core;
}

// --- fetchResponse ---

export function fetchResponse(
  url: string | URL | Request,
  options?: RequestInit & { timeoutMs?: number; retry?: RetryOptions | number },
): AsyncResult<
  Response,
  FetchNetworkError | FetchAbortError | FetchTimeoutError
> {
  const oneAttempt = () =>
    executeFetch(url, options ?? {}, options?.timeoutMs);
  if (options?.retry !== undefined) {
    return retryAsync(oneAttempt, normalizeRetryOptions(options.retry));
  }
  return oneAttempt();
}
