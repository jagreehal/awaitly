import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchKrokiPdf } from "./fetch";
import type { WorkflowIR } from "../types";
import type { UrlGenerator } from "./url";

describe("fetchKrokiPdf", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses generator.toPdfUrl without altering the URL", async () => {
    const pdfUrl = "https://example.com/diagram?format=pdf";

    const generator: UrlGenerator = {
      toUrl: () => "https://example.com/diagram?format=svg",
      toSvgUrl: () => "https://example.com/diagram?format=svg",
      toPngUrl: () => "https://example.com/diagram?format=png",
      toPdfUrl: () => pdfUrl,
      getBaseUrl: () => "https://example.com",
    };

    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    await fetchKrokiPdf(ir, { generator });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(pdfUrl);
  });
});
