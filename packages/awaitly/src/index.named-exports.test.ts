import { describe, expect, it } from "vitest";
import * as root from "./index";
import { Awaitly, ok, err, map, pipe } from "./index";

describe("root named exports", () => {
  it("keeps named exports aligned with Awaitly namespace", () => {
    expect(ok(1)).toEqual(Awaitly.ok(1));
    expect(err("E")).toEqual(Awaitly.err("E"));

    const mapped = map(ok(2), (n) => n + 1);
    const mappedViaNamespace = Awaitly.map(Awaitly.ok(2), (n) => n + 1);
    expect(mapped).toEqual(mappedViaNamespace);

    const piped = pipe(2, (n) => n * 2);
    const pipedViaNamespace = Awaitly.pipe(2, (n) => n * 2);
    expect(piped).toBe(pipedViaNamespace);
  });

  it("exports new result helpers as named root exports", () => {
    expect(root.flatten).toBe(Awaitly.flatten);
    expect(root.deserialize).toBe(Awaitly.deserialize);
    expect(root.DESERIALIZATION_ERROR).toBe(Awaitly.DESERIALIZATION_ERROR);
  });
});
