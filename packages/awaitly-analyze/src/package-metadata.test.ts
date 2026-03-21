import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("package metadata", () => {
  it("declares typescript as a runtime dependency when it is loaded dynamically", () => {
    const packageJsonPath = join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    const declaredVersion =
      packageJson.dependencies?.typescript ?? packageJson.peerDependencies?.typescript;

    expect(declaredVersion).toBeTruthy();
  });
});
