import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("docs import paths for result extras", () => {
  it("uses dedicated subpath for retry helper", () => {
    const docs = readFileSync(
      new URL(
        "../../../../apps/docs-site/src/content/docs/foundations/result-types.mdx",
        import.meta.url
      ),
      "utf8"
    );

    expect(docs).toMatch(/from 'awaitly\/result\/retry'/);

    expect(docs).not.toMatch(
      /import\s+\{[^}]*\btryAsyncRetry\b[^}]*\}\s+from\s+'awaitly\/result'/
    );
  });
});
