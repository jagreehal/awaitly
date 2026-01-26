/**
 * Tests for fetch.ts - Type-safe fetch helpers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchJson,
  fetchText,
  fetchBlob,
  fetchArrayBuffer,
  type DefaultFetchError,
} from "./fetch";

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
  // fetchJson Tests
  // ===========================================================================

  describe("fetchJson", () => {
    it("should return parsed JSON on successful response", async () => {
      const mockData = { id: 1, name: "Alice" };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(mockData),
      } as Response);

      const result = await fetchJson<typeof mockData>("/api/users/1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockData);
      }
      expect(global.fetch).toHaveBeenCalledWith("/api/users/1", {});
    });

    it("should handle empty JSON response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
      } as Response);

      const result = await fetchJson("/api/empty");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("should return NOT_FOUND error for 404 status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      } as Response);

      const result = await fetchJson("/api/users/999");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
        expect(result.cause).toEqual({ status: 404, statusText: "Not Found" });
      }
    });

    it("should return BAD_REQUEST error for 400 status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "",
      } as Response);

      const result = await fetchJson("/api/users");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("BAD_REQUEST");
      }
    });

    it("should return UNAUTHORIZED error for 401 status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "",
      } as Response);

      const result = await fetchJson("/api/protected");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("UNAUTHORIZED");
      }
    });

    it("should return FORBIDDEN error for 403 status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "",
      } as Response);

      const result = await fetchJson("/api/admin");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("FORBIDDEN");
      }
    });

    it("should return SERVER_ERROR error for 500 status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "",
      } as Response);

      const result = await fetchJson("/api/error");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("SERVER_ERROR");
      }
    });

    it("should return SERVER_ERROR error for other 5xx status codes", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "",
      } as Response);

      const result = await fetchJson("/api/service");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("SERVER_ERROR");
      }
    });

    it("should return NETWORK_ERROR when fetch rejects", async () => {
      const networkError = new Error("Network error");
      global.fetch = vi.fn().mockRejectedValue(networkError);

      const result = await fetchJson("/api/users/1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NETWORK_ERROR");
        expect(result.cause).toBe(networkError);
      }
    });

    it("should return NETWORK_ERROR for invalid JSON", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "invalid json {",
      } as Response);

      const result = await fetchJson("/api/invalid-json");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NETWORK_ERROR");
      }
    });

    it("should use custom error mapper function", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      } as Response);

      const result = await fetchJson<
        { id: number },
        "USER_NOT_FOUND" | "API_ERROR"
      >("/api/users/999", {
        error: (status) => {
          if (status === 404) return "USER_NOT_FOUND" as const;
          return "API_ERROR" as const;
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("USER_NOT_FOUND");
      }
    });

    it("should use custom error mapper function for multiple status codes", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "",
      } as Response);

      const result = await fetchJson<
        { id: number },
        "USER_NOT_FOUND" | "RATE_LIMITED" | "API_ERROR"
      >("/api/users/1", {
        error: (status) => {
          if (status === 404) return "USER_NOT_FOUND" as const;
          if (status === 429) return "RATE_LIMITED" as const;
          return "API_ERROR" as const;
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("RATE_LIMITED");
      }
    });

    it("should use single error value for all HTTP errors", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "",
      } as Response);

      const result = await fetchJson<{ id: number }, "API_ERROR">(
        "/api/users/1",
        {
          error: "API_ERROR" as const,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("API_ERROR");
      }
    });

    it("should pass fetch options to fetch", async () => {
      const mockData = { id: 1 };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(mockData),
      } as Response);

      await fetchJson("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice" }),
      });

      expect(global.fetch).toHaveBeenCalledWith("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should work with URL object", async () => {
      const mockData = { id: 1 };
      const url = new URL("/api/users/1", "https://example.com");
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(mockData),
      } as Response);

      const result = await fetchJson<typeof mockData>(url);

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(url, {});
    });

    it("should work with Request object", async () => {
      const mockData = { id: 1 };
      const request = new Request("https://example.com/api/users/1");
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(mockData),
      } as Response);

      const result = await fetchJson<typeof mockData>(request);

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(request, {});
    });
  });

  // ===========================================================================
  // fetchText Tests
  // ===========================================================================

  describe("fetchText", () => {
    it("should return text on successful response", async () => {
      const textData = "Hello, World!";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => textData,
      } as Response);

      const result = await fetchText("/api/text");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(textData);
      }
    });

    it("should return error for non-2xx response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      } as Response);

      const result = await fetchText("/api/missing");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
    });

    it("should return NETWORK_ERROR when fetch rejects", async () => {
      const networkError = new Error("Network error");
      global.fetch = vi.fn().mockRejectedValue(networkError);

      const result = await fetchText("/api/text");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NETWORK_ERROR");
      }
    });

    it("should use custom error mapper", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "",
      } as Response);

      const result = await fetchText<"CUSTOM_ERROR">("/api/text", {
        error: "CUSTOM_ERROR" as const,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("CUSTOM_ERROR");
      }
    });
  });

  // ===========================================================================
  // fetchBlob Tests
  // ===========================================================================

  describe("fetchBlob", () => {
    it("should return Blob on successful response", async () => {
      const blobData = new Blob(["test"], { type: "text/plain" });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        blob: async () => blobData,
      } as Response);

      const result = await fetchBlob("/api/blob");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(blobData);
      }
    });

    it("should return error for non-2xx response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        blob: async () => new Blob(),
      } as Response);

      const result = await fetchBlob("/api/missing");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
    });

    it("should return NETWORK_ERROR when fetch rejects", async () => {
      const networkError = new Error("Network error");
      global.fetch = vi.fn().mockRejectedValue(networkError);

      const result = await fetchBlob("/api/blob");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NETWORK_ERROR");
      }
    });
  });

  // ===========================================================================
  // fetchArrayBuffer Tests
  // ===========================================================================

  describe("fetchArrayBuffer", () => {
    it("should return ArrayBuffer on successful response", async () => {
      const bufferData = new ArrayBuffer(8);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => bufferData,
      } as Response);

      const result = await fetchArrayBuffer("/api/binary");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(bufferData);
      }
    });

    it("should return error for non-2xx response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response);

      const result = await fetchArrayBuffer("/api/missing");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
    });

    it("should return NETWORK_ERROR when fetch rejects", async () => {
      const networkError = new Error("Network error");
      global.fetch = vi.fn().mockRejectedValue(networkError);

      const result = await fetchArrayBuffer("/api/binary");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NETWORK_ERROR");
      }
    });
  });

  // ===========================================================================
  // Error Mapping Tests
  // ===========================================================================

  describe("error mapping", () => {
    it("should map all default status codes correctly", async () => {
      const testCases: Array<{ status: number; expected: DefaultFetchError }> =
        [
          { status: 400, expected: "BAD_REQUEST" },
          { status: 401, expected: "UNAUTHORIZED" },
          { status: 403, expected: "FORBIDDEN" },
          { status: 404, expected: "NOT_FOUND" },
          { status: 500, expected: "SERVER_ERROR" },
          { status: 502, expected: "SERVER_ERROR" },
          { status: 503, expected: "SERVER_ERROR" },
        ];

      for (const { status, expected } of testCases) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status,
          statusText: "Error",
          text: async () => "",
        } as Response);

        const result = await fetchJson("/api/test");

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe(expected);
        }
      }
    });

    it("should pass response object to custom error mapper", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers({ "X-Custom": "value" }),
        text: async () => "",
      } as Response;

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const errorMapper = vi.fn((status, response) => {
        expect(response).toBe(mockResponse);
        return "CUSTOM_ERROR" as const;
      });

      await fetchJson("/api/test", { error: errorMapper });

      expect(errorMapper).toHaveBeenCalledWith(404, mockResponse);
    });

    it("should handle custom error mapper that returns different types", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      } as Response);

      // Error mapper returning object
      const result1 = await fetchJson<{ id: number }, { code: number }>(
        "/api/test",
        {
          error: (status) => ({ code: status }),
        }
      );

      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        expect(result1.error).toEqual({ code: 404 });
      }

      // Error mapper returning number
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Error",
        text: async () => "",
      } as Response);

      const result2 = await fetchJson<{ id: number }, number>("/api/test", {
        error: (status) => status,
      });

      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.error).toBe(500);
      }
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe("integration with workflows", () => {
    it("should work with step() in workflows", async () => {
      const mockData = { id: 1, name: "Alice" };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(mockData),
      } as Response);

      // Simulate workflow usage
      const fetchUser = async () => {
        return await fetchJson<typeof mockData>("/api/users/1");
      };

      const result = await fetchUser();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockData);
      }
    });

    it("should propagate errors correctly in workflows", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      } as Response);

      const fetchUser = async () => {
        return await fetchJson<{ id: number }>("/api/users/999");
      };

      const result = await fetchUser();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
    });
  });
});
