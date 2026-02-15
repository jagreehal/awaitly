import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, err } from "./core";
import {
  fetchJson,
  fetchText,
  fetchBlob,
  fetchArrayBuffer,
  fetchResponse,
  type FetchHttpError,
  type FetchParseError,
  type FetchDecodeError,
  type FetchTimeoutError,
  type FetchAbortError,
  type FetchNetworkError,
} from "./fetch";

// Helper: create a mock Response
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: string;
  headers?: Record<string, string>;
}): Response {
  const status = opts.status ?? 200;
  return {
    ok: opts.ok ?? (status >= 200 && status < 300),
    status,
    statusText: opts.statusText ?? "OK",
    headers: new Headers(opts.headers ?? {}),
    text: vi.fn().mockResolvedValue(opts.body ?? ""),
    json: vi.fn().mockImplementation(async () => JSON.parse(opts.body ?? "")),
    blob: vi.fn().mockResolvedValue(new Blob([opts.body ?? ""])),
    arrayBuffer: vi
      .fn()
      .mockResolvedValue(new TextEncoder().encode(opts.body ?? "").buffer),
  } as unknown as Response;
}

// Helper: mock fetch that hangs until signal aborts
function mockHangingFetch() {
  global.fetch = vi.fn().mockImplementation(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
}

describe("fetch helpers", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // fetchJson
  // ===========================================================================

  describe("fetchJson", () => {
    it("should parse JSON on success", async () => {
      const data = { id: 1, name: "Alice" };
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: JSON.stringify(data) }),
      );

      const result = await fetchJson<typeof data>("/api/users/1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(data);
      }
    });

    it("should return null for 204 No Content", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ status: 204, statusText: "No Content", body: "" }),
      );

      const result = await fetchJson("/api/delete");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("should return null for 200 with empty body", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: "" }),
      );

      const result = await fetchJson("/api/empty");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("should return FetchHttpError for non-2xx status", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          status: 404,
          ok: false,
          statusText: "Not Found",
          body: JSON.stringify({ message: "not found" }),
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await fetchJson("/api/users/999");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchHttpError;
        expect(error._tag).toBe("FetchHttpError");
        expect(error.status).toBe(404);
        expect(error.statusText).toBe("Not Found");
        expect(error.body).toEqual({ message: "not found" });
      }
    });

    it("should return FetchParseError for invalid JSON", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: "not valid json {" }),
      );

      const result = await fetchJson("/api/bad-json");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchParseError;
        expect(error._tag).toBe("FetchParseError");
        expect(error.text).toBe("not valid json {");
        expect(error.cause).toBeInstanceOf(SyntaxError);
      }
    });

    it("should return FetchParseError when reading response body fails", async () => {
      const cause = new Error("Body stream read failed");
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        text: vi.fn().mockRejectedValue(cause),
      } as unknown as Response);

      const result = await fetchJson("/api/body-read-error");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchParseError;
        expect(error._tag).toBe("FetchParseError");
        expect(error.cause).toBe(cause);
      }
    });

    it("should return FetchNetworkError when fetch rejects", async () => {
      const networkError = new Error("Failed to fetch");
      global.fetch = vi.fn().mockRejectedValue(networkError);

      const result = await fetchJson("/api/users/1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchNetworkError;
        expect(error._tag).toBe("FetchNetworkError");
        expect(error.cause).toBe(networkError);
      }
    });

    it("should retry on failure when retry option is set", async () => {
      const goodResponse = mockResponse({
        body: JSON.stringify({ id: 1, name: "Alice" }),
      });
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(goodResponse);

      const result = await fetchJson("/api/users/1", { retry: 2 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ id: 1, name: "Alice" });
      }
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should return last error when retries exhausted", async () => {
      const networkError = new Error("Network error");
      global.fetch = vi.fn().mockRejectedValue(networkError);

      const result = await fetchJson("/api/users/1", { retry: 2 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchNetworkError)._tag).toBe(
          "FetchNetworkError",
        );
        expect((result.error as FetchNetworkError).cause).toBe(networkError);
      }
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should pass fetch options through", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: JSON.stringify({ id: 1 }) }),
      );

      await fetchJson("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice" }),
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/users",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice" }),
        }),
      );
    });

    it("should work with URL object", async () => {
      const url = new URL("/api/users/1", "https://example.com");
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: JSON.stringify({ id: 1 }) }),
      );

      const result = await fetchJson(url);

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(url, expect.any(Object));
    });
  });

  // ===========================================================================
  // fetchText
  // ===========================================================================

  describe("fetchText", () => {
    it("should return text on success", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: "Hello, World!" }),
      );

      const result = await fetchText("/api/text");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("Hello, World!");
      }
    });

    it("should return FetchHttpError for non-2xx", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ status: 500, ok: false, statusText: "Internal Server Error", body: "error" }),
      );

      const result = await fetchText("/api/text");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchHttpError;
        expect(error._tag).toBe("FetchHttpError");
        expect(error.status).toBe(500);
      }
    });

    it("should return FetchNetworkError on rejection", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await fetchText("/api/text");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchNetworkError)._tag).toBe("FetchNetworkError");
      }
    });

    it("should return FetchNetworkError when reading success body fails", async () => {
      const cause = new Error("Text stream read failed");
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: vi.fn().mockRejectedValue(cause),
      } as unknown as Response);

      const result = await fetchText("/api/text");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchNetworkError;
        expect(error._tag).toBe("FetchNetworkError");
        expect(error.cause).toBe(cause);
      }
    });
  });

  // ===========================================================================
  // fetchBlob
  // ===========================================================================

  describe("fetchBlob", () => {
    it("should return Blob on success", async () => {
      const blobData = new Blob(["test"], { type: "text/plain" });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        blob: vi.fn().mockResolvedValue(blobData),
        text: vi.fn().mockResolvedValue("test"),
      } as unknown as Response);

      const result = await fetchBlob("/api/blob");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(blobData);
      }
    });

    it("should return FetchHttpError for non-2xx", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ status: 404, ok: false, statusText: "Not Found", body: "" }),
      );

      const result = await fetchBlob("/api/missing");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchHttpError)._tag).toBe("FetchHttpError");
      }
    });
  });

  // ===========================================================================
  // fetchArrayBuffer
  // ===========================================================================

  describe("fetchArrayBuffer", () => {
    it("should return ArrayBuffer on success", async () => {
      const bufferData = new ArrayBuffer(8);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(bufferData),
        text: vi.fn().mockResolvedValue(""),
      } as unknown as Response);

      const result = await fetchArrayBuffer("/api/binary");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(bufferData);
      }
    });

    it("should return FetchHttpError for non-2xx", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ status: 403, ok: false, statusText: "Forbidden", body: "" }),
      );

      const result = await fetchArrayBuffer("/api/protected");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchHttpError)._tag).toBe("FetchHttpError");
        expect((result.error as FetchHttpError).status).toBe(403);
      }
    });
  });

  // ===========================================================================
  // fetchResponse
  // ===========================================================================

  describe("fetchResponse", () => {
    it("should return Response for 2xx status", async () => {
      const resp = mockResponse({ body: "ok" });
      global.fetch = vi.fn().mockResolvedValue(resp);

      const result = await fetchResponse("/api/data");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(resp);
      }
    });

    it("should return Response for non-2xx status (no error checking)", async () => {
      const resp = mockResponse({ status: 404, ok: false, statusText: "Not Found" });
      global.fetch = vi.fn().mockResolvedValue(resp);

      const result = await fetchResponse("/api/missing");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(resp);
        expect(result.value.status).toBe(404);
      }
    });

    it("should return FetchNetworkError on rejection", async () => {
      const cause = new Error("Network error");
      global.fetch = vi.fn().mockRejectedValue(cause);

      const result = await fetchResponse("/api/data");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchNetworkError;
        expect(error._tag).toBe("FetchNetworkError");
        expect(error.cause).toBe(cause);
      }
    });
  });

  // ===========================================================================
  // Timeout
  // ===========================================================================

  describe("timeout", () => {
    it("should return FetchTimeoutError when request times out", async () => {
      mockHangingFetch();

      const result = await fetchJson("/api/slow", { timeoutMs: 10 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchTimeoutError;
        expect(error._tag).toBe("FetchTimeoutError");
        expect(error.ms).toBe(10);
      }
    });

    it("should succeed if response arrives before timeout", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: JSON.stringify({ ok: true }) }),
      );

      const result = await fetchJson("/api/fast", { timeoutMs: 5000 });

      expect(result.ok).toBe(true);
    });

    it("should work with fetchResponse", async () => {
      mockHangingFetch();

      const result = await fetchResponse("/api/slow", { timeoutMs: 10 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchTimeoutError)._tag).toBe("FetchTimeoutError");
      }
    });
  });

  // ===========================================================================
  // Abort
  // ===========================================================================

  describe("abort", () => {
    it("should return FetchAbortError when user signal aborts", async () => {
      mockHangingFetch();
      const controller = new AbortController();

      setTimeout(() => controller.abort("user cancelled"), 5);

      const result = await fetchJson("/api/data", { signal: controller.signal });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchAbortError;
        expect(error._tag).toBe("FetchAbortError");
        expect(error.reason).toBe("user cancelled");
      }
    });

    it("should return FetchAbortError for pre-aborted signal", async () => {
      mockHangingFetch();
      const controller = new AbortController();
      controller.abort("already cancelled");

      const result = await fetchJson("/api/data", { signal: controller.signal });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchAbortError;
        expect(error._tag).toBe("FetchAbortError");
        expect(error.reason).toBe("already cancelled");
      }
    });

    it("should work with fetchResponse", async () => {
      mockHangingFetch();
      const controller = new AbortController();

      setTimeout(() => controller.abort("cancelled"), 5);

      const result = await fetchResponse("/api/data", { signal: controller.signal });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchAbortError)._tag).toBe("FetchAbortError");
      }
    });
  });

  // ===========================================================================
  // Decode
  // ===========================================================================

  describe("decode", () => {
    it("should return decoded value on success", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: JSON.stringify({ name: "Alice", age: 30 }) }),
      );

      const decode = (raw: unknown) => {
        const data = raw as { name: unknown; age: unknown };
        if (typeof data.name !== "string") {
          return err({ issues: [{ path: "name", expected: "string" }] });
        }
        return ok({ name: data.name, age: data.age });
      };

      const result = await fetchJson<{ name: string; age: unknown }>("/api/user", { decode });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ name: "Alice", age: 30 });
      }
    });

    it("should return FetchDecodeError when decode fails", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({ body: JSON.stringify({ name: 123 }) }),
      );

      const issues = [{ path: "name", expected: "string", got: "number" }];
      const decode = (_raw: unknown) => err({ issues });

      const result = await fetchJson("/api/user", { decode });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchDecodeError;
        expect(error._tag).toBe("FetchDecodeError");
        expect(error.issues).toEqual(issues);
      }
    });
  });

  // ===========================================================================
  // errorBody
  // ===========================================================================

  describe("errorBody", () => {
    it("should read JSON error body by default", async () => {
      const errorPayload = { code: "USER_NOT_FOUND", message: "User not found" };
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          status: 404,
          ok: false,
          statusText: "Not Found",
          body: JSON.stringify(errorPayload),
        }),
      );

      const result = await fetchJson("/api/users/999");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchHttpError;
        expect(error.body).toEqual(errorPayload);
      }
    });

    it("should read text error body as fallback", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          status: 500,
          ok: false,
          statusText: "Internal Server Error",
          body: "Something went wrong",
        }),
      );

      const result = await fetchJson("/api/error");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchHttpError;
        expect(error.body).toBe("Something went wrong");
      }
    });

    it("should exclude body for empty error responses", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          status: 404,
          ok: false,
          statusText: "Not Found",
          body: "",
        }),
      );

      const result = await fetchJson("/api/empty-error");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchHttpError;
        expect(error).not.toHaveProperty("body");
      }
    });

    it("should use custom errorBody reader", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          status: 422,
          ok: false,
          statusText: "Unprocessable Entity",
          body: JSON.stringify({ errors: [{ field: "email", message: "invalid" }] }),
        }),
      );

      type ApiError = { errors: Array<{ field: string; message: string }> };
      const errorBody = async (res: Response): Promise<ApiError> => {
        const text = await res.text();
        return JSON.parse(text) as ApiError;
      };

      const result = await fetchJson("/api/validate", { errorBody });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchHttpError<ApiError>;
        expect(error.body?.errors[0]).toEqual({ field: "email", message: "invalid" });
      }
    });
  });

  // ===========================================================================
  // strictContentType
  // ===========================================================================

  describe("strictContentType", () => {
    it("should return FetchParseError on content-type mismatch", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          body: "<html>Not JSON</html>",
          headers: { "content-type": "text/html" },
        }),
      );

      const result = await fetchJson("/api/wrong-type", { strictContentType: true });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = result.error as FetchParseError;
        expect(error._tag).toBe("FetchParseError");
        expect(error.text).toBe("<html>Not JSON</html>");
      }
    });

    it("should succeed when content-type matches", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          body: JSON.stringify({ ok: true }),
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      );

      const result = await fetchJson("/api/correct-type", { strictContentType: true });

      expect(result.ok).toBe(true);
    });

    it("should accept application/problem+json as JSON content-type", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          body: JSON.stringify({ type: "about:blank", title: "Not Found" }),
          headers: { "content-type": "application/problem+json" },
        }),
      );

      const result = await fetchJson("/api/problem", { strictContentType: true });

      expect(result.ok).toBe(true);
    });

    it("should accept application/vnd.api+json as JSON content-type", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          body: JSON.stringify({ data: [] }),
          headers: { "content-type": "application/vnd.api+json" },
        }),
      );

      const result = await fetchJson("/api/jsonapi", { strictContentType: true });

      expect(result.ok).toBe(true);
    });

    it("should ignore content-type when not strict", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          body: JSON.stringify({ ok: true }),
          headers: { "content-type": "text/html" },
        }),
      );

      const result = await fetchJson("/api/any-type");

      expect(result.ok).toBe(true);
    });
  });

  // ===========================================================================
  // mapError
  // ===========================================================================

  describe("mapError", () => {
    it("should map HTTP errors to custom domain errors", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          status: 404,
          ok: false,
          statusText: "Not Found",
          body: JSON.stringify({ message: "not found" }),
        }),
      );

      const mapError = (httpError: FetchHttpError) => ({
        code: "USER_NOT_FOUND" as const,
        status: httpError.status,
      });

      const result = await fetchJson("/api/users/999", { mapError });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ code: "USER_NOT_FOUND", status: 404 });
      }
    });

    it("should not affect non-HTTP errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const mapError = (_httpError: FetchHttpError) => ({ code: "MAPPED" });

      const result = await fetchJson("/api/data", { mapError });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Should be FetchNetworkError, not mapped
        expect((result.error as FetchNetworkError)._tag).toBe("FetchNetworkError");
      }
    });

    it("should evaluate retryOn against FetchHttpError before mapError (parity with other fetch helpers)", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          mockResponse({
            status: 500,
            ok: false,
            statusText: "Internal Server Error",
            body: JSON.stringify({ message: "try again" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            body: JSON.stringify({ ok: true }),
          }),
        );

      const mapError = (_httpError: FetchHttpError) => ({
        code: "MAPPED_HTTP_ERROR" as const,
      });

      const result = await fetchJson<
        { ok: boolean },
        unknown,
        { code: "MAPPED_HTTP_ERROR" }
      >("/api/retry-map-error", {
        mapError,
        retry: {
          attempts: 2,
          retryOn: (error) =>
            typeof error === "object" &&
            error !== null &&
            "_tag" in error &&
            (error as { _tag: unknown })._tag === "FetchHttpError",
        },
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ ok: true });
      }
    });
  });

  // ===========================================================================
  // Signal composition
  // ===========================================================================

  describe("signal composition", () => {
    it("should compose timeout with user signal", async () => {
      mockHangingFetch();
      const controller = new AbortController();

      // Timeout at 10ms, don't abort user signal
      const result = await fetchJson("/api/slow", {
        timeoutMs: 10,
        signal: controller.signal,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Timeout should fire first
        expect((result.error as FetchTimeoutError)._tag).toBe("FetchTimeoutError");
      }
    });

    it("should return FetchAbortError when user aborts before timeout", async () => {
      mockHangingFetch();
      const controller = new AbortController();

      // Abort immediately, timeout at 5000ms
      setTimeout(() => controller.abort("user abort"), 1);

      const result = await fetchJson("/api/data", {
        timeoutMs: 5000,
        signal: controller.signal,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchAbortError)._tag).toBe("FetchAbortError");
        expect((result.error as FetchAbortError).reason).toBe("user abort");
      }
    });

    it("should respect pre-aborted signal on Request input", async () => {
      mockHangingFetch();
      const controller = new AbortController();
      controller.abort("request aborted");
      const request = new Request("https://example.com/api/data", {
        signal: controller.signal,
      });

      const result = await fetchJson(request, { timeoutMs: 10 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchAbortError)._tag).toBe("FetchAbortError");
        expect((result.error as FetchAbortError).reason).toBe("request aborted");
      }
    });

    it("should respect Request signal abort before timeout", async () => {
      mockHangingFetch();
      const controller = new AbortController();
      const request = new Request("https://example.com/api/data", {
        signal: controller.signal,
      });

      setTimeout(() => controller.abort("request abort"), 1);

      const result = await fetchJson(request, { timeoutMs: 50 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchAbortError)._tag).toBe("FetchAbortError");
        expect((result.error as FetchAbortError).reason).toBe("request abort");
      }
    });

    it("should allow overriding Request signal with null", async () => {
      mockHangingFetch();
      const controller = new AbortController();
      controller.abort("request aborted");
      const request = new Request("https://example.com/api/data", {
        signal: controller.signal,
      });

      const result = await fetchJson(request, { signal: null, timeoutMs: 10 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchTimeoutError)._tag).toBe("FetchTimeoutError");
        expect((result.error as FetchTimeoutError).ms).toBe(10);
      }
    });

    it("should preserve Request signal when init.signal is undefined", async () => {
      mockHangingFetch();
      const controller = new AbortController();
      controller.abort("request aborted");
      const request = new Request("https://example.com/api/data", {
        signal: controller.signal,
      });

      const result = await fetchJson(request, { signal: undefined, timeoutMs: 10 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as FetchAbortError)._tag).toBe("FetchAbortError");
        expect((result.error as FetchAbortError).reason).toBe("request aborted");
      }
    });
  });
});
